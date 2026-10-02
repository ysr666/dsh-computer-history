import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import {
  PHASE1_ADAPTERS,
  CollectorSessionId,
  type ActivityObservation,
  type EpisodeId,
  type ObservationAdapter,
  type ObservationId,
  type ResourceId,
  type ResourceKind,
  type SurfaceKind,
  type WorkspaceSource,
} from '../../shared/index.js'
import type { PersistedActivityObservation } from '../episodes/index.js'

function requiredString(
  row: Record<string, SQLOutputValue>,
  key: string,
): string {
  const value = row[key]
  if (typeof value !== 'string') {
    throw new Error(`invalid observation row: ${key} must be a string`)
  }
  return value
}

function optionalString(
  row: Record<string, SQLOutputValue>,
  key: string,
): string | undefined {
  const value = row[key]
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`invalid observation row: ${key} must be a string or null`)
  }
  return value
}

function requiredNumber(
  row: Record<string, SQLOutputValue>,
  key: string,
): number {
  const value = row[key]
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`invalid observation row: ${key} must be numeric`)
  }
  return Number(value)
}

function optionalNumber(
  row: Record<string, SQLOutputValue>,
  key: string,
): number | undefined {
  const value = row[key]
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`invalid observation row: ${key} must be numeric or null`)
  }
  return Number(value)
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

function workspaceSource(value: string): WorkspaceSource {
  if (
    value === 'dsh'
    || value === 'git'
    || value === 'filesystem'
    || value === 'none'
  ) return value
  throw new Error(`invalid workspace source: ${value}`)
}

/**
 * Adapter ids this store accepts.
 *
 * The list is the shared adapter table plus the generic bucket, never a copy:
 * a copied list silently rejected every observation from adapters added later
 * (xcode, word, wps, jetbrains) with `invalid observation adapter`, which the
 * collector-side probes could not reveal. `tests/integration/ingestion.spec.ts`
 * now ingests one observation per table entry, so the two cannot drift again.
 */
function adapter(value: string): ObservationAdapter {
  if (value === 'generic') return value
  if (PHASE1_ADAPTERS.some(entry => entry.id === value)) {
    return value as ObservationAdapter
  }
  throw new Error(`invalid observation adapter: ${value}`)
}

function resourceKind(value: string): ResourceKind {
  if (
    value === 'file'
    || value === 'directory'
    || value === 'url'
    || value === 'document'
    || value === 'workspace'
  ) return value
  throw new Error(`invalid resource kind: ${value}`)
}

export class ObservationStore {
  public constructor(private readonly db: DatabaseSync) {}

  public insert(
    observation: ActivityObservation,
    resourceId?: ResourceId,
  ): ObservationId {
    this.db.prepare(`
      INSERT OR IGNORE INTO observations(
        collector_session,
        collector_seq,
        observed_at_ms,
        pid,
        bundle_id,
        app_name,
        surface_kind,
        window_title,
        element_role,
        element_subrole,
        element_identifier,
        element_title,
        resource_id,
        workspace_id,
        workspace_root,
        workspace_title,
        workspace_source,
        workspace_confidence,
        idle_seconds,
        privacy_secure,
        privacy_protected,
        privacy_reason,
        source_provider,
        source_adapter,
        policy_revision,
        expires_at_ms
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      )
    `).run(
      observation.collectorSessionId,
      observation.seq,
      observation.observedAtMs,
      observation.app.pid,
      observation.app.bundleId,
      observation.app.displayName ?? null,
      observation.surface.kind,
      observation.surface.title ?? null,
      observation.element?.role ?? null,
      observation.element?.subrole ?? null,
      observation.element?.identifier ?? null,
      observation.element?.title ?? null,
      resourceId ?? null,
      observation.workspace.id ?? null,
      observation.workspace.root ?? null,
      observation.workspace.title ?? null,
      observation.workspace.source,
      observation.workspace.confidence,
      observation.activity.idleSeconds ?? null,
      observation.privacy.secure ? 1 : 0,
      observation.privacy.protected ? 1 : 0,
      observation.privacy.reason ?? null,
      observation.source.provider,
      observation.source.adapter,
      observation.policyRevision,
      observation.expiresAtMs,
    )

    const row = this.db.prepare(`
      SELECT id
      FROM observations
      WHERE collector_session = ? AND collector_seq = ?
    `).get(
      observation.collectorSessionId,
      observation.seq,
    ) as { id: number } | undefined

    if (!row) throw new Error('observation insert did not produce a row')
    return row.id as ObservationId
  }

  public hasCollectorSequence(
    collectorSession: string,
    seq: number,
  ): boolean {
    return this.db.prepare(`
      SELECT 1 AS present
      FROM observations
      WHERE collector_session = ? AND collector_seq = ?
      LIMIT 1
    `).get(collectorSession, seq) !== undefined
  }

  public getById(
    id: ObservationId,
  ): PersistedActivityObservation | undefined {
    const row = this.db.prepare(`
      SELECT
        o.*,
        r.kind AS resource_kind,
        r.canonical_uri AS resource_uri,
        r.display_label AS resource_label
      FROM observations o
      LEFT JOIN resources r ON r.id = o.resource_id
      WHERE o.id = ?
    `).get(id)

    return row ? this.materialize(row) : undefined
  }

  public listForEpisode(
    episodeId: EpisodeId,
  ): readonly PersistedActivityObservation[] {
    return this.db.prepare(`
      SELECT
        o.*,
        r.kind AS resource_kind,
        r.canonical_uri AS resource_uri,
        r.display_label AS resource_label
      FROM episode_observations eo
      JOIN observations o ON o.id = eo.observation_id
      LEFT JOIN resources r ON r.id = o.resource_id
      WHERE eo.episode_id = ?
      ORDER BY o.observed_at_ms, o.collector_session, o.collector_seq
    `).all(episodeId).map((row) => this.materialize(row))
  }

  public listAll(): readonly PersistedActivityObservation[] {
    return this.db.prepare(`
      SELECT o.*, r.kind AS resource_kind, r.canonical_uri AS resource_uri,
        r.display_label AS resource_label
      FROM observations o
      LEFT JOIN resources r ON r.id = o.resource_id
      ORDER BY o.observed_at_ms, o.collector_session, o.collector_seq
    `).all().map((row) => this.materialize(row))
  }

  public deleteExpired(nowMs: number): number {
    return Number(
      this.db.prepare(
        'DELETE FROM observations WHERE expires_at_ms <= ?',
      ).run(nowMs).changes,
    )
  }

  public count(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS count FROM observations',
    ).get() as { count: number }
    return Number(row.count)
  }

  private materialize(
    row: Record<string, SQLOutputValue>,
  ): PersistedActivityObservation {
    const appName = optionalString(row, 'app_name')
    const windowTitle = optionalString(row, 'window_title')
    const elementRole = optionalString(row, 'element_role')
    const elementSubrole = optionalString(row, 'element_subrole')
    const elementIdentifier = optionalString(row, 'element_identifier')
    const elementTitle = optionalString(row, 'element_title')
    const workspaceId = optionalString(row, 'workspace_id')
    const workspaceRoot = optionalString(row, 'workspace_root')
    const workspaceTitle = optionalString(row, 'workspace_title')
    const idleSeconds = optionalNumber(row, 'idle_seconds')
    const privacyReason = optionalString(row, 'privacy_reason')
    const resourceUri = optionalString(row, 'resource_uri')
    const resourceKindValue = optionalString(row, 'resource_kind')
    const resourceLabel = optionalString(row, 'resource_label')

    return {
      id: requiredNumber(row, 'id') as ObservationId,
      collectorSessionId: CollectorSessionId(
        requiredString(row, 'collector_session'),
      ),
      seq: requiredNumber(row, 'collector_seq'),
      observedAtMs: requiredNumber(row, 'observed_at_ms'),
      app: {
        pid: requiredNumber(row, 'pid'),
        bundleId: requiredString(row, 'bundle_id'),
        ...(appName ? { displayName: appName } : {}),
      },
      surface: {
        kind: surfaceKind(requiredString(row, 'surface_kind')),
        ...(windowTitle ? { title: windowTitle } : {}),
      },
      ...(
        elementRole
        || elementSubrole
        || elementIdentifier
        || elementTitle
          ? {
              element: {
                ...(elementRole ? { role: elementRole } : {}),
                ...(elementSubrole ? { subrole: elementSubrole } : {}),
                ...(elementIdentifier ? { identifier: elementIdentifier } : {}),
                ...(elementTitle ? { title: elementTitle } : {}),
              },
            }
          : {}
      ),
      ...(
        resourceUri && resourceKindValue
          ? {
              resource: {
                kind: resourceKind(resourceKindValue),
                canonicalUri: resourceUri,
                ...(resourceLabel ? { displayLabel: resourceLabel } : {}),
              },
            }
          : {}
      ),
      workspace: {
        ...(workspaceId ? { id: workspaceId } : {}),
        ...(workspaceRoot ? { root: workspaceRoot } : {}),
        ...(workspaceTitle ? { title: workspaceTitle } : {}),
        source: workspaceSource(requiredString(row, 'workspace_source')),
        confidence: requiredNumber(row, 'workspace_confidence'),
      },
      activity: idleSeconds === undefined ? {} : { idleSeconds },
      privacy: {
        secure: requiredNumber(row, 'privacy_secure') === 1,
        protected: requiredNumber(row, 'privacy_protected') === 1,
        ...(privacyReason ? { reason: privacyReason } : {}),
      },
      source: {
        provider: 'macos-ax',
        adapter: adapter(requiredString(row, 'source_adapter')),
      },
      policyRevision: requiredNumber(row, 'policy_revision'),
      expiresAtMs: requiredNumber(row, 'expires_at_ms'),
    }
  }
}
