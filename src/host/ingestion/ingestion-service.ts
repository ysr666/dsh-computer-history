import type { DatabaseSync } from 'node:sqlite'
import {
  EPISODE_RETENTION_MS,
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
import { normalizeObservation } from './normalize.js'

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

  public constructor(
    private readonly db: DatabaseSync,
    private readonly workspaceResolver:
      WorkspaceResolver,
    private readonly policy: () => PolicySnapshot,
    private readonly now: () => number = Date.now,
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

  public async ingest(
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

    const preliminary = normalizeObservation(
      message,
      this.policy(),
      this.now(),
    )
    if (!preliminary) return false

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

    const workspace = await this.workspaceResolver.resolve(
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

      const observation = normalizeObservation(
        message,
        this.policy(),
        this.now(),
        workspace,
        canonicalResource,
      )
      if (!observation) {
        this.db.exec('COMMIT')
        return false
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
      if (this.db.isTransaction) {
        this.db.exec('ROLLBACK')
      }
      this.reseed()
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
      if (ownsTransaction) {
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
      // Append-mode provenance is derived directly from newly linked
      // observations in EpisodeStore, so the hot path never rewrites
      // the Episode's full resource/surface aggregate.
      resources: [],
      surfaces: [],
    }, {
      provenance: 'append',
      ...(appendObservationIds === undefined
        ? {}
        : { appendObservationIds }),
    })
  }
}
