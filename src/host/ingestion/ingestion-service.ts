import type { DatabaseSync } from 'node:sqlite'
import {
  EPISODE_RETENTION_MS,
  OBSERVATION_RETENTION_MS,
  type EpisodeDetail,
  type NativeObservation,
  type ObservationId,
  type PolicySnapshot,
  type ResourceIdentity,
  type WorkspaceRef,
} from '../../shared/index.js'
import {
  buildEpisodes,
  IncrementalEpisodeBuilder,
} from '../episodes/index.js'
import {
  DeletionLogStore,
  EpisodeStore,
  ObservationStore,
  ResourceStore,
} from '../store/index.js'
import { canonicalizeResource } from './canonicalize.js'
import {
  normalizeObservation,
  type RefusalReason,
  type RefusalReport,
} from './normalize.js'

export interface WorkspaceResolver {
  resolve(
    resource: ResourceIdentity | undefined,
  ): Promise<WorkspaceRef>
}

export class IngestionService {
  private readonly observations: ObservationStore
  private readonly resources: ResourceStore
  private readonly episodes: EpisodeStore
  private readonly deletions: DeletionLogStore
  private builder: IncrementalEpisodeBuilder
  private dataVersion: number
  private inFlight: Promise<void> = Promise.resolve()

  public constructor(
    private readonly db: DatabaseSync,
    private readonly workspaceResolver:
      WorkspaceResolver,
    private readonly policy: () => PolicySnapshot,
    private readonly now: () => number = Date.now,
    // Last, so the existing positional contract is untouched: a new parameter
    // in the middle silently re-points every caller that passed `now`.
    private readonly observationRetentionMs: () => number = () =>
      OBSERVATION_RETENTION_MS,
  ) {
    this.observations = new ObservationStore(db)
    this.resources = new ResourceStore(db)
    this.episodes = new EpisodeStore(db)
    this.deletions = new DeletionLogStore(db)
    this.builder = new IncrementalEpisodeBuilder()
    this.dataVersion = 0
    this.reseed()
  }

  private replayableObservations() {
    const excludedObservationIds = new Set<number>(
      this.db.prepare(`
        SELECT eo.observation_id AS id
        FROM episode_observations eo
        JOIN episodes e ON e.id = eo.episode_id
        WHERE (
          SELECT COUNT(*)
          FROM episode_observations linked
          WHERE linked.episode_id = e.id
        ) != COALESCE((
          SELECT SUM(es.observation_count)
          FROM episode_surfaces es
          WHERE es.episode_id = e.id
        ), 0)
      `).all().map(row => Number(row.id)),
    )

    return this.observations.listAll().filter(
      observation => !excludedObservationIds.has(
        Number(observation.id),
      ),
    )
  }

  private readDataVersion(): number {
    const row = this.db.prepare(
      'PRAGMA data_version',
    ).get() as { data_version: number }
    return Number(row.data_version)
  }

  public reseed(): void {
    const ownsTransaction = !this.db.isTransaction
    if (ownsTransaction) {
      this.db.exec('BEGIN IMMEDIATE')
    }

    try {
      this.builder = new IncrementalEpisodeBuilder(
        this.replayableObservations(),
      )
      this.dataVersion = this.readDataVersion()
      if (ownsTransaction) {
        this.db.exec('COMMIT')
      }
    } catch (error) {
      if (ownsTransaction && this.db.isTransaction) {
        this.db.exec('ROLLBACK')
      }
      throw error
    }
  }

  /**
   * Resolves once no `ingest` call is still in flight. Teardown uses
   * this so the database is never closed underneath a write: closing
   * during an open transaction silently discards it.
   */
  public whenIdle(): Promise<void> {
    return this.inFlight
  }

  /**
   * How many messages were turned away since this Host started. An empty timeline
   * means one of several things; this is the number that separates "nothing
   * happened" from "the policy refused everything".
   */
  private readonly refusals = new Map<RefusalReason, number>()

  public refusedSinceStart(): number {
    let total = 0
    for (const count of this.refusals.values()) total += count
    return total
  }

  /**
   * Why things were refused, not only how many. "Twelve observations were refused
   * because nothing is allowed" is a sentence a new user can act on; "twelve were
   * refused" is not (T2.9-3).
   */
  public refusalCounts(): ReadonlyMap<RefusalReason, number> {
    return this.refusals
  }

  private refuse(reason: RefusalReason): false {
    this.refusals.set(reason, (this.refusals.get(reason) ?? 0) + 1)
    return false
  }

  public async ingest(
    message: NativeObservation,
  ): Promise<boolean> {
    const before = this.refusedSinceStart()
    const running = this.ingestNow(message)
    void running.then((stored) => {
      // Refusals that named their reason are already counted; the rest are visible
      // as unattributed rather than missing from the total.
      if (!stored && this.refusedSinceStart() === before) {
        this.refusals.set('unknown', (this.refusals.get('unknown') ?? 0) + 1)
      }
    })
    const idle: Promise<void> = running
      .then(() => undefined, () => undefined)
    this.inFlight = idle
    void idle.then(() => {
      if (this.inFlight === idle) {
        this.inFlight = Promise.resolve()
      }
    })
    return running
  }

  private async ingestNow(
    message: NativeObservation,
  ): Promise<boolean> {
    if (this.readDataVersion() !== this.dataVersion) {
      this.reseed()
    }

    if (
      this.observations.hasCollectorSequence(
        message.collectorSession,
        message.seq,
      )
    ) {
      return false
    }

    const preliminaryRefusal: RefusalReport = {}
    const preliminary = normalizeObservation(
      message,
      this.policy(),
      this.now(),
      undefined,
      undefined,
      this.observationRetentionMs(),
      preliminaryRefusal,
    )
    // This is the path an unallowed application takes, which is the case a new
    // installation hits first - counting it anywhere else counted nothing.
    if (!preliminary) return this.refuse(preliminaryRefusal.reason ?? 'unknown')

    const canonicalResource =
      await canonicalizeResource(preliminary.resource)
    if (preliminary.resource && !canonicalResource) {
      return false
    }
    const canonicalPreliminary = normalizeObservation(
      message,
      this.policy(),
      this.now(),
      { source: 'none', confidence: 0 },
      canonicalResource,
    )
    if (!canonicalPreliminary) return false

    // A paired companion's answer beats an inference: the editor says where the
    // work is, the resolver can only guess from a path (ADR 0009). Nothing else
    // may make this claim - an Accessibility observation carrying a workspace is
    // ignored, not believed.
    const vouched = message.source.provider === 'companion'
      ? message.workspace
      : undefined
    const workspace: WorkspaceRef = vouched
      ? {
          id: vouched.root,
          root: vouched.root,
          ...(vouched.title === undefined ? {} : { title: vouched.title }),
          source: 'companion',
          confidence: 1,
        }
      : await this.workspaceResolver.resolve(
          canonicalPreliminary.resource,
        )

    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (this.readDataVersion() !== this.dataVersion) {
        this.reseed()
      }

      if (
        this.observations.hasCollectorSequence(
          message.collectorSession,
          message.seq,
        )
      ) {
        this.db.exec('COMMIT')
        return false
      }

      const refusal: RefusalReport = {}
      const observation = normalizeObservation(
        message,
        this.policy(),
        this.now(),
        workspace,
        canonicalResource,
        this.observationRetentionMs(),
        refusal,
      )
      if (!observation) {
        this.db.exec('COMMIT')
        return this.refuse(refusal.reason ?? 'unknown')
      }

      if (this.deletions.blocksObservation({
        observedAtMs: observation.observedAtMs,
        bundleId: observation.app.bundleId,
      })) {
        this.db.exec('COMMIT')
        return false
      }

      const outOfOrder =
        this.builder.lastObservedAt !== undefined
        && observation.observedAtMs
          < this.builder.lastObservedAt

      const resourceId = observation.resource
        ? this.resources.upsert(
            observation.resource,
            observation.observedAtMs,
          )
        : undefined

      const observationId = this.observations.insert(
        observation,
        resourceId,
      )
      const persisted =
        this.observations.getById(observationId)

      if (!persisted) {
        throw new Error(
          'persisted observation could not be reloaded',
        )
      }

      if (outOfOrder) {
        const nextBuilder =
          this.fullRepairWithinTransaction()
        this.db.exec('COMMIT')
        this.builder = nextBuilder
        return true
      }

      this.persistBuiltEpisodes(
        this.builder.push(
          persisted,
          { emission: 'compact' },
        ),
        persisted.id,
      )
      this.db.exec('COMMIT')
      return true
    } catch (error) {
      // Recovery is best-effort and must never replace the original
      // failure. During host teardown the database can already be
      // closed, in which case `isTransaction` itself throws; letting
      // that escape from inside this catch would mask the real error
      // and skip the reseed entirely.
      try {
        if (this.db.isTransaction) {
          this.db.exec('ROLLBACK')
        }
      } catch {
        // The transaction is already gone with the connection.
      }
      try {
        this.reseed()
      } catch {
        // A reseed failure is surfaced by the next successful ingest,
        // which re-reads data_version before writing.
      }
      throw error
    }
  }

  private fullRepairWithinTransaction():
    IncrementalEpisodeBuilder {
    if (!this.db.isTransaction) {
      throw new Error(
        'full repair requires an active transaction',
      )
    }

    // Raw retention may have compacted provenance for older Episodes.
    // Those derived Episodes must survive their independent 30-day TTL:
    // rebuilding them from only the remaining raw tail would be lossy.
    const all = this.replayableObservations()
    const built = buildEpisodes(all)

    this.db.exec(`
      DELETE FROM episodes
      WHERE (
        SELECT COUNT(*)
        FROM episode_observations linked
        WHERE linked.episode_id = episodes.id
      ) = COALESCE((
        SELECT SUM(es.observation_count)
        FROM episode_surfaces es
        WHERE es.episode_id = episodes.id
      ), 0)
    `)
    this.persistBuiltEpisodes(built)
    return new IncrementalEpisodeBuilder(all)
  }

  private persistBuiltEpisodes(
    built: readonly EpisodeDetail[],
    appendedObservationId?: ObservationId,
  ): void {
    if (built.length === 0) return

    const ownsTransaction = !this.db.isTransaction
    if (ownsTransaction) {
      this.db.exec('BEGIN IMMEDIATE')
    }

    try {
      for (const episode of built) {
        const appendsCurrent =
          appendedObservationId !== undefined
          && episode.observationIds.at(-1)
            === appendedObservationId
        this.persistEpisode(
          episode,
          appendedObservationId === undefined
            ? undefined
            : appendsCurrent
              ? [appendedObservationId]
              : [],
        )
      }
      if (ownsTransaction) {
        this.db.exec('COMMIT')
      }
    } catch (error) {
      if (ownsTransaction && this.db.isTransaction) {
        this.db.exec('ROLLBACK')
      }
      throw error
    }
  }

  private persistEpisode(
    episode: EpisodeDetail,
    appendObservationIds?: readonly ObservationId[],
  ): void {
    const lastStrongResourceId =
      episode.lastStrongResource
        ? this.resources.findId(
            episode.lastStrongResource,
          )
        : undefined
    if (
      episode.lastStrongResource
      && lastStrongResourceId === undefined
    ) {
      throw new Error(
        `missing last strong resource for episode ${episode.id}`,
      )
    }

    const timestamp = this.now()
    this.episodes.replace({
      id: episode.id,
      startedAtMs: episode.startedAtMs,
      endedAtMs: episode.endedAtMs,
      startReason: episode.boundary.startReason,
      summaryObservationIds: episode.summaryObservationIds,
      endReason:
        episode.boundary.endReason ?? 'timeout',
      ...(episode.workspace
        ? { workspace: episode.workspace }
        : {}),
      ...(episode.threadKey
        ? { threadKey: episode.threadKey }
        : {}),
      ...(lastStrongResourceId === undefined
        ? {}
        : { lastStrongResourceId }),
      summaryKind: episode.summaryKind,
      summary: episode.summary,
      confidence: episode.confidence,
      state: episode.state,
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
      expiresAtMs: Math.min(
        Number.MAX_SAFE_INTEGER,
        episode.endedAtMs + EPISODE_RETENTION_MS,
      ),
      observationIds: episode.observationIds,
      // Aggregate provenance is derived by EpisodeStore from whatever
      // ends up linked: incrementally on the append fast path, and
      // recomputed from the links on a full replace. Passing counters
      // from here would let them drift from the link set, which is the
      // exact comparison deletion uses to decide completeness.
    }, {
      provenance: 'append',
      ...(appendObservationIds === undefined
        ? {}
        : { appendObservationIds }),
    })
  }
}
