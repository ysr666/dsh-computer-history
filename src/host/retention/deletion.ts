import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  EPISODE_RETENTION_MS,
  type DeleteHistoryRequest,
  type DeleteHistoryResult,
  type EpisodeDetail,
  type EpisodeId,
  type ResourceId,
} from '../../shared/index.js'
import { buildEpisodes } from '../episodes/index.js'
import {
  DeletionLogStore,
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

interface DeletionPlan {
  readonly populateTargets: () => void
  readonly extraEpisodeIds?: readonly EpisodeId[]
  readonly audit?: {
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

  public constructor(private readonly db: DatabaseSync) {
    this.observations = new ObservationStore(db)
    this.resources = new ResourceStore(db)
    this.episodes = new EpisodeStore(db)
    this.log = new DeletionLogStore(db)
  }

  public delete(
    request: DeleteHistoryRequest,
    nowMs = Date.now(),
  ): DeleteHistoryResult {
    const scope = request.scope

    if (scope.kind === 'time-range' && scope.endMs <= scope.startMs) {
      throw new Error('delete time range must have endMs > startMs')
    }

    const allEpisodeIds = scope.kind === 'all'
      ? this.listAllEpisodeIds()
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
      ...(scope.kind === 'episode'
        ? { extraEpisodeIds: [scope.episodeId] }
        : {}),
      ...(allEpisodeIds
        ? { extraEpisodeIds: allEpisodeIds }
        : {}),
      audit: {
        scope: scope.kind,
        ...(scope.kind === 'time-range'
          ? {
              rangeStartMs: scope.startMs,
              rangeEndMs: scope.endMs,
            }
          : {}),
        ...(scope.kind === 'app'
          ? { bundleId: scope.bundleId }
          : {}),
      },
    }, nowMs)
  }

  public deleteExpiredObservations(
    nowMs = Date.now(),
  ): DeleteHistoryResult {
    return this.execute({
      populateTargets: () => {
        this.db.prepare(`
          INSERT INTO deletion_targets(id)
          SELECT id
          FROM observations
          WHERE expires_at_ms <= ?
        `).run(nowMs)
      },
    }, nowMs)
  }

  private execute(
    plan: DeletionPlan,
    nowMs: number,
  ): DeleteHistoryResult {
    if (this.db.isTransaction) {
      throw new Error('history deletion must own the outer transaction')
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('DROP TABLE IF EXISTS deletion_targets')
      this.db.exec(
        'CREATE TEMP TABLE deletion_targets(id INTEGER PRIMARY KEY)',
      )
      plan.populateTargets()

      const targetCount = Number(
        (this.db.prepare(
          'SELECT COUNT(*) AS count FROM deletion_targets',
        ).get() as { count: number }).count,
      )

      const affected = new Set<EpisodeId>(
        this.linkedAffectedEpisodeIds(),
      )
      for (const id of plan.extraEpisodeIds ?? []) {
        if (this.episodes.get(id)) affected.add(id)
      }

      this.db.exec(`
        DELETE FROM observations
        WHERE id IN (SELECT id FROM deletion_targets)
      `)

      let episodesDeleted = 0
      let episodesRebuilt = 0

      for (const episodeId of [...affected].toSorted()) {
        const remaining = this.observations.listForEpisode(episodeId)
        this.episodes.delete(episodeId)

        if (remaining.length === 0) {
          episodesDeleted += 1
          continue
        }

        const rebuilt = buildEpisodes(remaining)
        if (rebuilt.length === 0) {
          episodesDeleted += 1
          continue
        }

        for (const episode of rebuilt) {
          this.persistRebuiltEpisode(episode, nowMs)
          episodesRebuilt += 1
        }
      }

      this.cleanupOrphanResources()

      if (plan.audit) {
        this.log.insert({
          id: randomUUID(),
          requestedAtMs: nowMs,
          scope: plan.audit.scope,
          ...(plan.audit.rangeStartMs === undefined
            ? {}
            : { rangeStartMs: plan.audit.rangeStartMs }),
          ...(plan.audit.rangeEndMs === undefined
            ? {}
            : { rangeEndMs: plan.audit.rangeEndMs }),
          ...(plan.audit.bundleId
            ? { bundleId: plan.audit.bundleId }
            : {}),
          observationsDeleted: targetCount,
          episodesDeleted,
          episodesRebuilt,
        })
      }

      this.db.exec('DROP TABLE deletion_targets')
      this.db.exec('COMMIT')

      if (plan.audit && targetCount > 0) {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
        this.db.exec('VACUUM')
      }

      return {
        observationsDeleted: targetCount,
        episodesDeleted,
        episodesRebuilt,
      }
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      try {
        this.db.exec('DROP TABLE IF EXISTS deletion_targets')
      } catch {
        // Ignore cleanup errors after rollback; original error is authoritative.
      }
      throw error
    }
  }

  private linkedAffectedEpisodeIds(): readonly EpisodeId[] {
    return this.db.prepare(`
      SELECT DISTINCT eo.episode_id AS id
      FROM episode_observations eo
      JOIN deletion_targets dt ON dt.id = eo.observation_id
      ORDER BY eo.episode_id
    `).all().map((row) => String(row.id) as EpisodeId)
  }

  private listAllEpisodeIds(): readonly EpisodeId[] {
    return this.db.prepare(
      'SELECT id FROM episodes ORDER BY id',
    ).all().map((row) => String(row.id) as EpisodeId)
  }

  private persistRebuiltEpisode(
    episode: EpisodeDetail,
    nowMs: number,
  ): void {
    const resourceIds = new Map<string, ResourceId>()

    for (const resource of episode.resources) {
      const id = this.resources.upsert(
        {
          kind: resource.kind,
          canonicalUri: resource.canonicalUri,
          ...(resource.displayLabel
            ? { displayLabel: resource.displayLabel }
            : {}),
        },
        resource.lastSeenAtMs,
      )
      resourceIds.set(resourceKey(resource), id)
    }

    const lastStrongResourceId = episode.lastStrongResource
      ? resourceIds.get(resourceKey(episode.lastStrongResource))
      : undefined

    this.episodes.replace({
      id: episode.id,
      startedAtMs: episode.startedAtMs,
      endedAtMs: episode.endedAtMs,
      startReason: episode.boundary.startReason,
      endReason: episode.boundary.endReason ?? 'manual-rebuild',
      ...(episode.workspace ? { workspace: episode.workspace } : {}),
      ...(episode.threadKey ? { threadKey: episode.threadKey } : {}),
      ...(lastStrongResourceId ? { lastStrongResourceId } : {}),
      summaryKind: episode.summaryKind,
      summary: episode.summary,
      confidence: episode.confidence,
      state: episode.state,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      expiresAtMs: nowMs + EPISODE_RETENTION_MS,
      observationIds: episode.observationIds,
      resources: episode.resources.map((resource) => {
        const id = resourceIds.get(resourceKey(resource))
        if (!id) {
          throw new Error(
            `missing resource id while rebuilding episode ${episode.id}`,
          )
        }
        return {
          resourceId: id,
          firstSeenAtMs: resource.firstSeenAtMs,
          lastSeenAtMs: resource.lastSeenAtMs,
          observationCount: resource.observationCount,
        }
      }),
      surfaces: episode.surfaces,
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
