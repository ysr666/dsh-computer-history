import type { DatabaseSync } from 'node:sqlite'
import type { ActivityObservation } from '../../shared/observation.js'
import type { ObservationId, ResourceId } from '../../shared/ids.js'

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
}
