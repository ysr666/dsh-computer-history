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

  /**
   * Incremental provenance is only sound when the Episode already links
   * the evidence it was derived from. Appending to a re-derived Episode
   * whose links were lost (for example after a conservative forget left
   * raw rows behind) would claim content while linking none of the raw
   * evidence behind it, leaving the resource/surface aggregates empty
   * while `hasCompleteProvenance` still certified it complete.
   *
   * The check is deliberately conservative and never materializes the
   * link set. Given the stored links' count, oldest and newest
   * identities *before* this call added anything, it requires the count
   * to fit inside the caller's list and both stored ends to sit exactly
   * where the caller's list puts them. The aggregate runs over the
   * `(episode_id, observation_id)` index, so it is a range scan whose
   * cost grows with the Episode's link count — the same order as the
   * link count the caller's delta already needs, not a full row read.
   * That rejects every state a writer in this process can reach — a
   * re-derived Episode starts from a *later* leftover, so it either has
   * no links or its oldest link is not the caller's first identity, and
   * an Episode whose tail moved has a newest link that does not sit
   * where the caller's list puts it. Failing the check is safe: the
   * Episode is rewritten in full.
   *
   * What it does not do is compare every stored link against the
   * caller's list, so an Episode whose links were corrupted into an
   * interior gap with both endpoints still matching could pass. No
   * writer here can produce that: every link insert uses an identity
   * drawn from the caller's own list, and every same-process mutation
   * reseeds the builder. Comparing the sets exactly would mean reading
   * every link row on each append, which is strictly more work than the
   * aggregate above and buys nothing for an unreachable state.
   */
  private appendIsProven(
    observationIds: readonly ObservationId[],
    stored: {
      readonly count: number
      readonly oldest: number | null
      readonly newest: number | null
    },
  ): boolean {
    if (observationIds.length === 0) return false
    if (stored.count > observationIds.length) return false
    if (stored.count === 0) return false
    if (stored.oldest === null || stored.newest === null) return false

    return Number(stored.oldest) === Number(observationIds[0])
      && Number(stored.newest)
        === Number(observationIds[stored.count - 1])
  }

  public replace(
    input: PersistEpisodeInput,
    options: PersistEpisodeOptions = {},
  ): void {
    const ownsTransaction = !this.db.isTransaction
    if (ownsTransaction) this.db.exec('BEGIN IMMEDIATE')
    const commit = (): void => {
      if (ownsTransaction) this.db.exec('COMMIT')
    }
    try {
      // Optimistic append: insert the new links, then verify against the
      // pre-insert boundary that the Episode already linked the
      // preceding evidence. A failure means this Episode was re-derived
      // from raw rows it no longer links, so the inserted links are
      // discarded and the Episode is rewritten with full provenance.
      let append = options.provenance === 'append'
        && input.observationIds.length > 0

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

      if (append) {
        // Sampled BEFORE the insert below: these are the links that
        // already existed, which is what the proof must reason about.
        const stored = this.db.prepare(`
          SELECT
            COUNT(*) AS count,
            MIN(observation_id) AS oldest,
            MAX(observation_id) AS newest
          FROM episode_observations
          WHERE episode_id = ?
        `).get(input.id) as {
          count: number
          oldest: number | null
          newest: number | null
        }
        const linkCount = Number(stored.count)

        if (linkCount > input.observationIds.length) {
          throw new Error(
            `episode provenance regressed for ${input.id}`,
          )
        }
        const requested = options.appendObservationIds
          ?? input.observationIds.slice(linkCount)

        // Only links this call actually created may contribute to the
        // aggregate counters. Counting a requested id that was already
        // linked would inflate `episode_surfaces` past the link count,
        // permanently marking the Episode as incompletely provenanced
        // and causing a later targeted forget to delete it wholesale.
        const appended: ObservationId[] = []
        for (const observationId of requested) {
          const inserted = insertObservation.run(
            input.id,
            observationId,
          )
          if (inserted.changes === 0) continue
          appended.push(observationId)
        }

        if (
          this.appendIsProven(input.observationIds, stored)
        ) {
          this.applyAppendedAggregates(input.id, appended)
          commit()
          return
        }

        // This Episode lost the provenance it was derived from. Discard
        // the optimistic link insert and rewrite in full: appending here
        // would claim the re-derived content while linking none of the
        // evidence behind it.
        append = false
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

      {
        for (const observationId of input.observationIds) {
          insertObservation.run(
            input.id,
            observationId,
          )
        }
        // Derive the aggregate provenance rows from the links this call
        // just wrote rather than trusting caller-supplied counters.
        // `hasCompleteProvenance` certifies completeness by comparing
        // the link count against these counters, so the two must never
        // be able to drift apart.
        this.reconcileAggregates(input.id)
      }

      commit()
    } catch (error) {
      if (ownsTransaction && this.db.isTransaction) {
        this.db.exec('ROLLBACK')
      }
      throw error
    }
  }

  /**
   * Increment an Episode's resource/surface aggregates for the links an
   * append just added. Only called once the append has been proven to
   * extend existing provenance, so each new link contributes exactly
   * one to its aggregate counters.
   */
  private applyAppendedAggregates(
    id: EpisodeId,
    appended: readonly ObservationId[],
  ): void {
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

    for (const observationId of appended) {
      appendResource.run(id, observationId)
      appendSurface.run(id, observationId)
    }
  }

  /**
   * Rebuild an Episode's resource/surface aggregates from the raw
   * observations currently linked to it. The full-replace path uses
   * this so the counters can never disagree with the link set, which is
   * what `DeletionService.hasCompleteProvenance` relies on to decide
   * whether an Episode is safe to rebuild or must be dropped whole.
   */
  private reconcileAggregates(id: EpisodeId): void {
    this.db.prepare(`
      INSERT INTO episode_resources(
        episode_id,
        resource_id,
        first_seen_at_ms,
        last_seen_at_ms,
        observation_count
      )
      SELECT
        eo.episode_id,
        o.resource_id,
        MIN(o.observed_at_ms),
        MAX(o.observed_at_ms),
        COUNT(*)
      FROM episode_observations eo
      JOIN observations o ON o.id = eo.observation_id
      WHERE eo.episode_id = ?
        AND o.resource_id IS NOT NULL
      GROUP BY eo.episode_id, o.resource_id
    `).run(id)

    this.db.prepare(`
      INSERT INTO episode_surfaces(
        episode_id,
        bundle_id,
        surface_kind,
        first_seen_at_ms,
        last_seen_at_ms,
        observation_count
      )
      SELECT
        eo.episode_id,
        o.bundle_id,
        o.surface_kind,
        MIN(o.observed_at_ms),
        MAX(o.observed_at_ms),
        COUNT(*)
      FROM episode_observations eo
      JOIN observations o ON o.id = eo.observation_id
      WHERE eo.episode_id = ?
      GROUP BY eo.episode_id, o.bundle_id, o.surface_kind
    `).run(id)
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
