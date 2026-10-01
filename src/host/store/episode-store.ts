import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import {
  EpisodeId,
  type EpisodeBoundaryReason,
  type EpisodeDetail,
  type EpisodeResourceSummary,
  type EpisodeState,
  type EpisodeSummary,
  type EpisodeSummaryKind,
  type EpisodeSurfaceSummary,
  type ObservationId,
  type ResourceId,
  type ResourceKind,
  type SurfaceKind,
} from '../../shared/index.js'

export interface PersistedEpisodeResource {
  readonly resourceId: ResourceId
  readonly firstSeenAtMs: number
  readonly lastSeenAtMs: number
  readonly observationCount: number
}

export interface PersistedEpisodeSurface extends EpisodeSurfaceSummary {}

export interface EpisodeListQuery {
  readonly sinceMs?: number
  readonly workspaceId?: string
  readonly limit?: number
}

export interface EpisodeSearchQuery extends EpisodeListQuery {
  readonly query: string
  readonly untilMs?: number
  readonly bundleId?: string
}

export interface PersistEpisodeOptions {
  readonly provenance?: 'replace' | 'append'
  readonly appendObservationIds?: readonly ObservationId[]
}

export interface PersistEpisodeInput {
  readonly id: EpisodeId
  readonly startedAtMs: number
  readonly endedAtMs: number
  readonly startReason: EpisodeBoundaryReason
  readonly endReason: EpisodeBoundaryReason
  readonly workspace?: {
    readonly id?: string
    readonly root?: string
    readonly title?: string
  }
  readonly threadKey?: string
  readonly lastStrongResourceId?: ResourceId
  readonly summaryKind: EpisodeSummaryKind
  readonly summary: string
  readonly confidence: number
  readonly state: EpisodeState
  readonly createdAtMs: number
  readonly updatedAtMs: number
  readonly expiresAtMs?: number
  readonly observationIds: readonly ObservationId[]
  readonly resources: readonly PersistedEpisodeResource[]
  readonly surfaces: readonly PersistedEpisodeSurface[]
}

function numberValue(
  row: Record<string, SQLOutputValue>,
  key: string,
): number {
  const value = row[key]
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`invalid episode row: ${key} must be numeric`)
  }
  return Number(value)
}

function nullableNumber(
  row: Record<string, SQLOutputValue>,
  key: string,
): number | undefined {
  const value = row[key]
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`invalid episode row: ${key} must be numeric or null`)
  }
  return Number(value)
}

function stringValue(
  row: Record<string, SQLOutputValue>,
  key: string,
): string {
  const value = row[key]
  if (typeof value !== 'string') {
    throw new Error(`invalid episode row: ${key} must be a string`)
  }
  return value
}

function nullableString(
  row: Record<string, SQLOutputValue>,
  key: string,
): string | undefined {
  const value = row[key]
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`invalid episode row: ${key} must be a string or null`)
  }
  return value
}

function optionalThreadKey(
  row: Record<string, SQLOutputValue>,
): { readonly threadKey?: string } {
  const value = nullableString(row, 'thread_key')
  return value ? { threadKey: value } : {}
}

function boundaryReason(value: string): EpisodeBoundaryReason {
  const allowed: readonly EpisodeBoundaryReason[] = [
    'first-observation',
    'workspace-switch',
    'idle',
    'sleep',
    'pause',
    'collector-restart',
    'timeout',
    'manual-rebuild',
  ]
  if (allowed.includes(value as EpisodeBoundaryReason)) {
    return value as EpisodeBoundaryReason
  }
  throw new Error(`invalid episode boundary reason: ${value}`)
}

function episodeState(value: string): EpisodeState {
  if (value === 'open' || value === 'closed' || value === 'invalidated') {
    return value
  }
  throw new Error(`invalid episode state: ${value}`)
}

function summaryKind(value: string): EpisodeSummaryKind {
  if (value === 'deterministic' || value === 'model') return value
  throw new Error(`invalid episode summary kind: ${value}`)
}

function surfaceKind(value: string): SurfaceKind {
  const allowed: readonly SurfaceKind[] = [
    'window',
    'editor',
    'terminal',
    'browser',
    'document',
    'unknown',
  ]
  if (allowed.includes(value as SurfaceKind)) return value as SurfaceKind
  throw new Error(`invalid surface kind: ${value}`)
}

function resourceKind(value: string): ResourceKind {
  const allowed: readonly ResourceKind[] = [
    'file',
    'directory',
    'url',
    'document',
    'workspace',
  ]
  if (allowed.includes(value as ResourceKind)) return value as ResourceKind
  throw new Error(`invalid resource kind: ${value}`)
}

export class EpisodeStore {
  public constructor(private readonly db: DatabaseSync) {}

  public replace(
    input: PersistEpisodeInput,
    options: PersistEpisodeOptions = {},
  ): void {
    const ownsTransaction = !this.db.isTransaction
    if (ownsTransaction) this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        INSERT INTO episodes(
          id,
          started_at_ms,
          ended_at_ms,
          start_reason,
          end_reason,
          primary_workspace_id,
          primary_workspace_root,
          primary_workspace_title,
          thread_key,
          last_strong_resource_id,
          summary_kind,
          summary_text,
          confidence,
          state,
          created_at_ms,
          updated_at_ms,
          expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          started_at_ms = excluded.started_at_ms,
          ended_at_ms = excluded.ended_at_ms,
          start_reason = excluded.start_reason,
          end_reason = excluded.end_reason,
          primary_workspace_id = excluded.primary_workspace_id,
          primary_workspace_root = excluded.primary_workspace_root,
          primary_workspace_title = excluded.primary_workspace_title,
          thread_key = excluded.thread_key,
          last_strong_resource_id = excluded.last_strong_resource_id,
          summary_kind = excluded.summary_kind,
          summary_text = excluded.summary_text,
          confidence = excluded.confidence,
          state = excluded.state,
          updated_at_ms = excluded.updated_at_ms,
          expires_at_ms = excluded.expires_at_ms
      `).run(
        input.id,
        input.startedAtMs,
        input.endedAtMs,
        input.startReason,
        input.endReason,
        input.workspace?.id ?? null,
        input.workspace?.root ?? null,
        input.workspace?.title ?? null,
        input.threadKey ?? null,
        input.lastStrongResourceId ?? null,
        input.summaryKind,
        input.summary,
        input.confidence,
        input.state,
        input.createdAtMs,
        input.updatedAtMs,
        input.expiresAtMs ?? null,
      )

      const append =
        options.provenance === 'append'

      if (!append) {
        this.db.prepare(
          'DELETE FROM episode_observations WHERE episode_id = ?',
        ).run(input.id)
        this.db.prepare(
          'DELETE FROM episode_resources WHERE episode_id = ?',
        ).run(input.id)
        this.db.prepare(
          'DELETE FROM episode_surfaces WHERE episode_id = ?',
        ).run(input.id)
      }

      const insertObservation = this.db.prepare(`
        INSERT OR IGNORE INTO episode_observations(
          episode_id,
          observation_id
        ) VALUES (?, ?)
      `)
      const observationStart =
        append && options.appendObservationIds === undefined
          ? Number(
              (
                this.db.prepare(`
                  SELECT COUNT(*) AS count
                  FROM episode_observations
                  WHERE episode_id = ?
                `).get(input.id) as { count: number }
              ).count,
            )
          : 0

      if (
        options.appendObservationIds === undefined
        && observationStart > input.observationIds.length
      ) {
        throw new Error(
          `episode provenance regressed for ${input.id}`,
        )
      }

      if (append) {
        const appendResource = this.db.prepare(`
          INSERT INTO episode_resources(
            episode_id,
            resource_id,
            first_seen_at_ms,
            last_seen_at_ms,
            observation_count
          )
          SELECT ?, o.resource_id, o.observed_at_ms, o.observed_at_ms, 1
          FROM observations o
          WHERE o.id = ?
            AND o.resource_id IS NOT NULL
          ON CONFLICT(episode_id, resource_id)
          DO UPDATE SET
            first_seen_at_ms = MIN(
              episode_resources.first_seen_at_ms,
              excluded.first_seen_at_ms
            ),
            last_seen_at_ms = MAX(
              episode_resources.last_seen_at_ms,
              excluded.last_seen_at_ms
            ),
            observation_count =
              episode_resources.observation_count + 1
        `)
        const appendSurface = this.db.prepare(`
          INSERT INTO episode_surfaces(
            episode_id,
            bundle_id,
            surface_kind,
            first_seen_at_ms,
            last_seen_at_ms,
            observation_count
          )
          SELECT ?, o.bundle_id, o.surface_kind,
            o.observed_at_ms, o.observed_at_ms, 1
          FROM observations o
          WHERE o.id = ?
          ON CONFLICT(
            episode_id,
            bundle_id,
            surface_kind
          )
          DO UPDATE SET
            first_seen_at_ms = MIN(
              episode_surfaces.first_seen_at_ms,
              excluded.first_seen_at_ms
            ),
            last_seen_at_ms = MAX(
              episode_surfaces.last_seen_at_ms,
              excluded.last_seen_at_ms
            ),
            observation_count =
              episode_surfaces.observation_count + 1
        `)

        const observationIds =
          options.appendObservationIds
          ?? input.observationIds.slice(observationStart)
        for (const observationId of observationIds) {
          const inserted = insertObservation.run(
            input.id,
            observationId,
          )
          if (inserted.changes === 0) continue
          appendResource.run(
            input.id,
            observationId,
          )
          appendSurface.run(
            input.id,
            observationId,
          )
        }
      } else {
        for (const observationId of input.observationIds) {
          insertObservation.run(
            input.id,
            observationId,
          )
        }

        const insertResource = this.db.prepare(`
          INSERT INTO episode_resources(
            episode_id,
            resource_id,
            first_seen_at_ms,
            last_seen_at_ms,
            observation_count
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(episode_id, resource_id)
          DO UPDATE SET
            first_seen_at_ms = excluded.first_seen_at_ms,
            last_seen_at_ms = excluded.last_seen_at_ms,
            observation_count = excluded.observation_count
        `)
        for (const resource of input.resources) {
          insertResource.run(
            input.id,
            resource.resourceId,
            resource.firstSeenAtMs,
            resource.lastSeenAtMs,
            resource.observationCount,
          )
        }

        const insertSurface = this.db.prepare(`
          INSERT INTO episode_surfaces(
            episode_id,
            bundle_id,
            surface_kind,
            first_seen_at_ms,
            last_seen_at_ms,
            observation_count
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(
            episode_id,
            bundle_id,
            surface_kind
          )
          DO UPDATE SET
            first_seen_at_ms = excluded.first_seen_at_ms,
            last_seen_at_ms = excluded.last_seen_at_ms,
            observation_count = excluded.observation_count
        `)
        for (const surface of input.surfaces) {
          insertSurface.run(
            input.id,
            surface.bundleId,
            surface.surfaceKind,
            surface.firstSeenAtMs,
            surface.lastSeenAtMs,
            surface.observationCount,
          )
        }
      }

      if (ownsTransaction) this.db.exec('COMMIT')
    } catch (error) {
      if (ownsTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  public get(id: EpisodeId): EpisodeDetail | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM episodes
      WHERE id = ?
    `).get(id)

    if (!row) return undefined
    return this.materialize(row)
  }

  public listRecent(
    query: EpisodeListQuery = {},
  ): readonly EpisodeSummary[] {
    const clauses = ["e.state != 'invalidated'"]
    const params: Array<string | number> = []

    if (query.sinceMs !== undefined) {
      clauses.push('e.ended_at_ms >= ?')
      params.push(query.sinceMs)
    }
    if (query.workspaceId) {
      clauses.push('e.primary_workspace_id = ?')
      params.push(query.workspaceId)
    }

    const bounded = Math.max(
      1,
      Math.min(1000, Math.trunc(query.limit ?? 20)),
    )
    params.push(bounded)

    return this.db.prepare(`
      SELECT e.*
      FROM episodes e
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.ended_at_ms DESC
      LIMIT ?
    `).all(...params).map((row) => this.materialize(row))
  }

  public search(
    query: EpisodeSearchQuery,
  ): readonly EpisodeSummary[] {
    const clauses = ["e.state != 'invalidated'"]
    const params: Array<string | number> = []

    if (query.sinceMs !== undefined) {
      clauses.push('e.ended_at_ms >= ?')
      params.push(query.sinceMs)
    }
    if (query.untilMs !== undefined) {
      clauses.push('e.started_at_ms < ?')
      params.push(query.untilMs)
    }
    if (query.workspaceId) {
      clauses.push('e.primary_workspace_id = ?')
      params.push(query.workspaceId)
    }
    if (query.bundleId) {
      clauses.push(`EXISTS (
        SELECT 1 FROM episode_surfaces es
        WHERE es.episode_id = e.id AND es.bundle_id = ?
      )`)
      params.push(query.bundleId)
    }

    const needle = `%${query.query.toLowerCase()}%`
    clauses.push(`(
      lower(e.summary_text) LIKE ?
      OR lower(COALESCE(e.primary_workspace_id, '')) LIKE ?
      OR lower(COALESCE(e.primary_workspace_title, '')) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM episode_resources er
        JOIN resources r ON r.id = er.resource_id
        WHERE er.episode_id = e.id
          AND (
            lower(r.canonical_uri) LIKE ?
            OR lower(COALESCE(r.display_label, '')) LIKE ?
          )
      )
    )`)
    params.push(needle, needle, needle, needle, needle)

    const bounded = Math.max(
      1,
      Math.min(100, Math.trunc(query.limit ?? 20)),
    )
    params.push(bounded)

    return this.db.prepare(`
      SELECT e.*
      FROM episodes e
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.ended_at_ms DESC
      LIMIT ?
    `).all(...params).map((row) => this.materialize(row))
  }

  public deleteAll(): number {
    return Number(this.db.prepare('DELETE FROM episodes').run().changes)
  }

  public delete(id: EpisodeId): boolean {
    return this.db.prepare(
      'DELETE FROM episodes WHERE id = ?',
    ).run(id).changes > 0
  }

  private materialize(
    row: Record<string, SQLOutputValue>,
  ): EpisodeDetail {
    const id = EpisodeId(stringValue(row, 'id'))
    const resources = this.readResources(id)
    const surfaces = this.readSurfaces(id)
    const observationIds = this.db.prepare(`
      SELECT observation_id
      FROM episode_observations
      WHERE episode_id = ?
      ORDER BY observation_id
    `).all(id).map(
      (item) => numberValue(item, 'observation_id') as ObservationId,
    )

    const workspaceId = nullableString(row, 'primary_workspace_id')
    const workspaceRoot = nullableString(row, 'primary_workspace_root')
    const workspaceTitle = nullableString(row, 'primary_workspace_title')
    const lastStrongResourceId = nullableNumber(row, 'last_strong_resource_id')
    const lastStrongResource = lastStrongResourceId === undefined
      ? undefined
      : resources.find((resource) =>
          this.resourceIdForEpisodeResource(id, resource) === lastStrongResourceId,
        )

    return {
      id,
      startedAtMs: numberValue(row, 'started_at_ms'),
      endedAtMs: numberValue(row, 'ended_at_ms'),
      boundary: {
        startReason: boundaryReason(stringValue(row, 'start_reason')),
        endReason: boundaryReason(stringValue(row, 'end_reason')),
      },
      ...(
        workspaceId || workspaceRoot || workspaceTitle
          ? {
              workspace: {
                ...(workspaceId ? { id: workspaceId } : {}),
                ...(workspaceRoot ? { root: workspaceRoot } : {}),
                ...(workspaceTitle ? { title: workspaceTitle } : {}),
              },
            }
          : {}
      ),
      ...optionalThreadKey(row),
      summaryKind: summaryKind(stringValue(row, 'summary_kind')),
      summary: stringValue(row, 'summary_text'),
      ...(lastStrongResource ? { lastStrongResource } : {}),
      resources,
      surfaces,
      confidence: numberValue(row, 'confidence'),
      state: episodeState(stringValue(row, 'state')),
      observationIds,
    }
  }

  private readResources(id: EpisodeId): EpisodeResourceSummary[] {
    return this.db.prepare(`
      SELECT
        r.id AS resource_id,
        r.kind,
        r.canonical_uri,
        r.display_label,
        er.first_seen_at_ms,
        er.last_seen_at_ms,
        er.observation_count
      FROM episode_resources er
      JOIN resources r ON r.id = er.resource_id
      WHERE er.episode_id = ?
      ORDER BY er.first_seen_at_ms, r.id
    `).all(id).map((row) => {
      const resource: {
        kind: ResourceKind
        canonicalUri: string
        displayLabel?: string
        firstSeenAtMs: number
        lastSeenAtMs: number
        observationCount: number
      } = {
        kind: resourceKind(stringValue(row, 'kind')),
        canonicalUri: stringValue(row, 'canonical_uri'),
        firstSeenAtMs: numberValue(row, 'first_seen_at_ms'),
        lastSeenAtMs: numberValue(row, 'last_seen_at_ms'),
        observationCount: numberValue(row, 'observation_count'),
      }
      const displayLabel = nullableString(row, 'display_label')
      if (displayLabel) resource.displayLabel = displayLabel
      return resource
    })
  }

  private readSurfaces(id: EpisodeId): EpisodeSurfaceSummary[] {
    return this.db.prepare(`
      SELECT
        bundle_id,
        surface_kind,
        first_seen_at_ms,
        last_seen_at_ms,
        observation_count
      FROM episode_surfaces
      WHERE episode_id = ?
      ORDER BY first_seen_at_ms, bundle_id, surface_kind
    `).all(id).map((row) => ({
      bundleId: stringValue(row, 'bundle_id'),
      surfaceKind: surfaceKind(stringValue(row, 'surface_kind')),
      firstSeenAtMs: numberValue(row, 'first_seen_at_ms'),
      lastSeenAtMs: numberValue(row, 'last_seen_at_ms'),
      observationCount: numberValue(row, 'observation_count'),
    }))
  }

  private resourceIdForEpisodeResource(
    id: EpisodeId,
    resource: EpisodeResourceSummary,
  ): number | undefined {
    const row = this.db.prepare(`
      SELECT r.id
      FROM episode_resources er
      JOIN resources r ON r.id = er.resource_id
      WHERE er.episode_id = ?
        AND r.kind = ?
        AND r.canonical_uri = ?
    `).get(id, resource.kind, resource.canonicalUri)

    return row ? numberValue(row, 'id') : undefined
  }
}
