import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  type DeleteHistoryRequest,
  type DeleteHistoryResult,
  type EpisodeDetail,
  type EpisodeId,
  type ResourceId,
} from '../../shared/index.js'
import { buildEpisodes } from '../episodes/index.js'
import {
  DeletionLogStore,
  DshCheckpointStore,
  EpisodeStore,
  ObservationStore,
  ResourceStore,
} from '../store/index.js'

function resourceKey(resource: {
  readonly kind: string
  readonly canonicalUri: string
}): string {
  return `${resource.kind}\u0000${resource.canonicalUri}`
}

interface EpisodeRetentionMeta {
  readonly createdAtMs: number
  readonly expiresAtMs?: number
}

interface DeletionPlan {
  readonly populateTargets: () => void
  readonly forceEpisodeIds?: readonly EpisodeId[]
  readonly derivedEpisodeIds?: readonly EpisodeId[]
  readonly audit: {
    readonly scope: 'time-range' | 'episode' | 'app' | 'all'
    readonly rangeStartMs?: number
    readonly rangeEndMs?: number
    readonly bundleId?: string
  }
}

export class DeletionService {
  private readonly observations: ObservationStore
  private readonly resources: ResourceStore
  private readonly episodes: EpisodeStore
  private readonly log: DeletionLogStore
  private readonly checkpoints: DshCheckpointStore

  public constructor(private readonly db: DatabaseSync) {
    this.observations = new ObservationStore(db)
    this.resources = new ResourceStore(db)
    this.episodes = new EpisodeStore(db)
    this.log = new DeletionLogStore(db)
    this.checkpoints = new DshCheckpointStore(db)
  }

  public delete(
    request: DeleteHistoryRequest,
    nowMs = Date.now(),
  ): DeleteHistoryResult {
    const scope = request.scope

    if (
      scope.kind === 'time-range'
      && scope.endMs <= scope.startMs
    ) {
      throw new Error(
        'delete time range must have endMs > startMs',
      )
    }

    const deletedEpisode =
      scope.kind === 'episode'
        ? this.episodes.get(scope.episodeId)
        : undefined

    const forceEpisodeIds = scope.kind === 'all'
      ? this.listAllEpisodeIds()
      : scope.kind === 'episode'
        ? [scope.episodeId]
        : undefined

    const derivedEpisodeIds = scope.kind === 'app'
      ? this.listEpisodesForApp(scope.bundleId)
      : scope.kind === 'time-range'
        ? this.listEpisodesOverlapping(
            scope.startMs,
            scope.endMs,
          )
        : undefined

    return this.execute({
      populateTargets: () => {
        if (scope.kind === 'all') {
          this.db.exec(`
            INSERT INTO deletion_targets(id)
            SELECT id FROM observations
          `)
          return
        }

        if (scope.kind === 'time-range') {
          this.db.prepare(`
            INSERT INTO deletion_targets(id)
            SELECT id
            FROM observations
            WHERE observed_at_ms >= ?
              AND observed_at_ms < ?
          `).run(scope.startMs, scope.endMs)
          return
        }

        if (scope.kind === 'app') {
          this.db.prepare(`
            INSERT INTO deletion_targets(id)
            SELECT id
            FROM observations
            WHERE bundle_id = ?
          `).run(scope.bundleId)
          return
        }

        this.db.prepare(`
          INSERT INTO deletion_targets(id)
          SELECT observation_id
          FROM episode_observations
          WHERE episode_id = ?
        `).run(scope.episodeId)
      },
      ...(forceEpisodeIds
        ? { forceEpisodeIds }
        : {}),
      ...(derivedEpisodeIds
        ? { derivedEpisodeIds }
        : {}),
      audit: {
        scope: scope.kind,
        ...(scope.kind === 'time-range'
          ? {
              rangeStartMs: scope.startMs,
              rangeEndMs: scope.endMs,
            }
          : {}),
        ...(scope.kind === 'episode' && deletedEpisode
          ? {
              rangeStartMs: deletedEpisode.startedAtMs,
              rangeEndMs: Math.min(
                Number.MAX_SAFE_INTEGER,
                deletedEpisode.endedAtMs + 1,
              ),
            }
          : {}),
        ...(scope.kind === 'app'
          ? { bundleId: scope.bundleId }
          : {}),
      },
    }, nowMs)
  }

  private execute(
    plan: DeletionPlan,
    nowMs: number,
  ): DeleteHistoryResult {
    if (this.db.isTransaction) {
      throw new Error(
        'history deletion must own the outer transaction',
      )
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec(
        'DROP TABLE IF EXISTS deletion_targets',
      )
      this.db.exec(
        'CREATE TEMP TABLE deletion_targets(id INTEGER PRIMARY KEY)',
      )
      plan.populateTargets()

      const targetCount = Number(
        (this.db.prepare(
          'SELECT COUNT(*) AS count FROM deletion_targets',
        ).get() as { count: number }).count,
      )

      const linked = new Set<EpisodeId>(
        this.linkedAffectedEpisodeIds(),
      )
      const forced = new Set<EpisodeId>(
        plan.forceEpisodeIds ?? [],
      )
      const derived = new Set<EpisodeId>(
        plan.derivedEpisodeIds ?? [],
      )
      const affected = new Set<EpisodeId>([
        ...linked,
        ...forced,
        ...derived,
      ])

      const completeness = new Map<
        EpisodeId,
        boolean
      >()
      const retention = new Map<
        EpisodeId,
        EpisodeRetentionMeta
      >()

      for (const episodeId of affected) {
        const meta = this.episodeRetentionMeta(episodeId)
        if (!meta) continue
        retention.set(episodeId, meta)
        completeness.set(
          episodeId,
          this.hasCompleteProvenance(episodeId),
        )
      }

      this.db.exec(`
        DELETE FROM observations
        WHERE id IN (SELECT id FROM deletion_targets)
      `)

      let episodesDeleted = 0
      let episodesRebuilt = 0

      for (const episodeId of [...affected].toSorted()) {
        if (!this.episodes.get(episodeId)) continue

        const isLinked = linked.has(episodeId)
        const isForced = forced.has(episodeId)
        const isDerivedOnly = derived.has(episodeId)
          && !isLinked
          && !isForced
        const complete =
          completeness.get(episodeId) ?? false

        // A derived-only overlap with complete raw provenance
        // but no matching raw target is not actually within
        // the requested deletion scope (possible for a time
        // range spanning an inactive gap).
        if (isDerivedOnly && complete) {
          continue
        }

        const remaining =
          this.observations.listForEpisode(episodeId)
        this.episodes.delete(episodeId)

        // Once raw TTL has compacted part of an Episode, a
        // user Forget/Delete request can no longer safely
        // reconstruct only the requested slice. Delete the
        // whole derived Episode rather than preserve content
        // that may have come from forgotten evidence.
        if (!complete || remaining.length === 0) {
          episodesDeleted += 1
          continue
        }

        const rebuilt = buildEpisodes(remaining)
        if (rebuilt.length === 0) {
          episodesDeleted += 1
          continue
        }

        const meta = retention.get(episodeId)
        for (const episode of rebuilt) {
          this.persistRebuiltEpisode(
            episode,
            nowMs,
            meta,
          )
          episodesRebuilt += 1
        }
      }

      this.cleanupOrphanResources()

      if (plan.audit.scope === 'all') {
        this.checkpoints.deleteAll()
      } else if (
        plan.audit.rangeStartMs !== undefined
        && plan.audit.rangeEndMs !== undefined
      ) {
        this.checkpoints.deleteRange(
          plan.audit.rangeStartMs,
          plan.audit.rangeEndMs,
        )
      }

      this.log.insert({
        id: randomUUID(),
        requestedAtMs: nowMs,
        scope: plan.audit.scope,
        ...(plan.audit.rangeStartMs === undefined
          ? {}
          : {
              rangeStartMs:
                plan.audit.rangeStartMs,
            }),
        ...(plan.audit.rangeEndMs === undefined
          ? {}
          : {
              rangeEndMs:
                plan.audit.rangeEndMs,
            }),
        ...(plan.audit.bundleId
          ? { bundleId: plan.audit.bundleId }
          : {}),
        observationsDeleted: targetCount,
        episodesDeleted,
        episodesRebuilt,
      })

      this.db.exec('DROP TABLE deletion_targets')
      this.db.exec('COMMIT')

      if (
        targetCount > 0
        || episodesDeleted > 0
        || episodesRebuilt > 0
      ) {
        // The logical deletion is already committed. Physical
        // compaction is best-effort: a concurrent reader may
        // temporarily prevent checkpoint/VACUUM, but that must
        // never turn a successful deletion into a false error.
        try {
          this.db.exec(
            'PRAGMA wal_checkpoint(TRUNCATE)',
          )
          this.db.exec('VACUUM')
        } catch {
          // secure_delete still applies to SQLite cell removal;
          // later maintenance/open cycles may reclaim pages.
        }
      }

      return {
        observationsDeleted: targetCount,
        episodesDeleted,
        episodesRebuilt,
      }
    } catch (error) {
      if (this.db.isTransaction) {
        this.db.exec('ROLLBACK')
      }
      try {
        this.db.exec(
          'DROP TABLE IF EXISTS deletion_targets',
        )
      } catch {
        // Original failure is authoritative.
      }
      throw error
    }
  }

  private linkedAffectedEpisodeIds():
    readonly EpisodeId[] {
    return this.db.prepare(`
      SELECT DISTINCT eo.episode_id AS id
      FROM episode_observations eo
      JOIN deletion_targets dt
        ON dt.id = eo.observation_id
      ORDER BY eo.episode_id
    `).all().map(
      row => String(row.id) as EpisodeId,
    )
  }

  private listAllEpisodeIds():
    readonly EpisodeId[] {
    return this.db.prepare(
      'SELECT id FROM episodes ORDER BY id',
    ).all().map(
      row => String(row.id) as EpisodeId,
    )
  }

  private listEpisodesForApp(
    bundleId: string,
  ): readonly EpisodeId[] {
    return this.db.prepare(`
      SELECT DISTINCT episode_id AS id
      FROM episode_surfaces
      WHERE bundle_id = ?
      ORDER BY episode_id
    `).all(bundleId).map(
      row => String(row.id) as EpisodeId,
    )
  }

  private listEpisodesOverlapping(
    startMs: number,
    endMs: number,
  ): readonly EpisodeId[] {
    return this.db.prepare(`
      SELECT id
      FROM episodes
      WHERE started_at_ms < ?
        AND ended_at_ms >= ?
      ORDER BY id
    `).all(endMs, startMs).map(
      row => String(row.id) as EpisodeId,
    )
  }

  private hasCompleteProvenance(
    episodeId: EpisodeId,
  ): boolean {
    const row = this.db.prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM episode_observations
          WHERE episode_id = ?
        ) AS linked,
        COALESCE((
          SELECT SUM(observation_count)
          FROM episode_surfaces
          WHERE episode_id = ?
        ), 0) AS expected
    `).get(
      episodeId,
      episodeId,
    ) as {
      linked: number
      expected: number
    }

    const linked = Number(row.linked)
    const expected = Number(row.expected)

    // Zero links is not evidence of completeness. A row with no linked
    // observations can happen after a conservative forget leaves an
    // Episode whose raw evidence has gone, and certifying it as
    // "complete" would let a later targeted deletion rebuild or retain
    // derived content that can no longer be proven free of the
    // forgotten evidence. `0 === 0` must count as incomplete.
    return linked > 0 && linked === expected
  }

  private episodeRetentionMeta(
    episodeId: EpisodeId,
  ): EpisodeRetentionMeta | undefined {
    const row = this.db.prepare(`
      SELECT created_at_ms, expires_at_ms
      FROM episodes
      WHERE id = ?
    `).get(episodeId) as {
      created_at_ms: number
      expires_at_ms: number | null
    } | undefined

    if (!row) return undefined
    return {
      createdAtMs: Number(row.created_at_ms),
      ...(row.expires_at_ms === null
        ? {}
        : {
            expiresAtMs:
              Number(row.expires_at_ms),
          }),
    }
  }

  private persistRebuiltEpisode(
    episode: EpisodeDetail,
    nowMs: number,
    retention?: EpisodeRetentionMeta,
  ): void {
    const resourceIds =
      new Map<string, ResourceId>()

    for (const resource of episode.resources) {
      const id = this.resources.upsert(
        {
          kind: resource.kind,
          canonicalUri: resource.canonicalUri,
          ...(resource.displayLabel
            ? {
                displayLabel:
                  resource.displayLabel,
              }
            : {}),
        },
        resource.lastSeenAtMs,
      )
      resourceIds.set(resourceKey(resource), id)
    }

    const lastStrongResourceId =
      episode.lastStrongResource
        ? resourceIds.get(
            resourceKey(
              episode.lastStrongResource,
            ),
          )
        : undefined

    this.episodes.replace({
      id: episode.id,
      startedAtMs: episode.startedAtMs,
      endedAtMs: episode.endedAtMs,
      startReason:
        episode.boundary.startReason,
      summaryObservationIds: episode.summaryObservationIds,
      endReason:
        episode.boundary.endReason
        ?? 'manual-rebuild',
      ...(episode.workspace
        ? { workspace: episode.workspace }
        : {}),
      ...(episode.threadKey
        ? { threadKey: episode.threadKey }
        : {}),
      ...(lastStrongResourceId
        ? { lastStrongResourceId }
        : {}),
      summaryKind: episode.summaryKind,
      summary: episode.summary,
      confidence: episode.confidence,
      state: episode.state,
      createdAtMs:
        retention?.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
      ...(retention?.expiresAtMs === undefined
        ? {}
        : {
            expiresAtMs:
              retention.expiresAtMs,
          }),
      observationIds:
        episode.observationIds,
    })
  }

  public cleanupOrphanResources(): void {
    this.db.exec(`
      DELETE FROM resources
      WHERE id NOT IN (
        SELECT resource_id
        FROM observations
        WHERE resource_id IS NOT NULL
      )
      AND id NOT IN (
        SELECT resource_id
        FROM episode_resources
      )
      AND id NOT IN (
        SELECT last_strong_resource_id
        FROM episodes
        WHERE last_strong_resource_id IS NOT NULL
      )
    `)
  }
}
