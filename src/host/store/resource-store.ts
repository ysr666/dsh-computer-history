import type { DatabaseSync } from 'node:sqlite'
import type { ResourceId } from '../../shared/ids.js'
import type { ResourceIdentity } from '../../shared/resource.js'

export interface StoredResource extends ResourceIdentity {
  readonly id: ResourceId
  readonly sensitivity: 'normal' | 'protected'
  readonly firstSeenAtMs: number
  readonly lastSeenAtMs: number
}

export class ResourceStore {
  public constructor(private readonly db: DatabaseSync) {}

  public upsert(
    resource: ResourceIdentity,
    seenAtMs: number,
    sensitivity: 'normal' | 'protected' = 'normal',
  ): ResourceId {
    this.db.prepare(`
      INSERT INTO resources(
        kind, canonical_uri, display_label, sensitivity, first_seen_at_ms, last_seen_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, canonical_uri) DO UPDATE SET
        display_label = COALESCE(excluded.display_label, resources.display_label),
        sensitivity = CASE
          WHEN resources.sensitivity = 'protected' THEN 'protected'
          ELSE excluded.sensitivity
        END,
        last_seen_at_ms = MAX(resources.last_seen_at_ms, excluded.last_seen_at_ms)
    `).run(
      resource.kind,
      resource.canonicalUri,
      resource.displayLabel ?? null,
      sensitivity,
      seenAtMs,
      seenAtMs,
    )

    const row = this.db.prepare(
      'SELECT id FROM resources WHERE kind = ? AND canonical_uri = ?',
    ).get(resource.kind, resource.canonicalUri) as { id: number } | undefined

    if (!row) throw new Error('resource upsert did not produce a row')
    return row.id as ResourceId
  }

  public findId(
    resource: Pick<ResourceIdentity, 'kind' | 'canonicalUri'>,
  ): ResourceId | undefined {
    const row = this.db.prepare(`
      SELECT id
      FROM resources
      WHERE kind = ? AND canonical_uri = ?
    `).get(
      resource.kind,
      resource.canonicalUri,
    ) as { id: number } | undefined

    return row?.id as ResourceId | undefined
  }

  public getById(id: ResourceId): StoredResource | undefined {
    const row = this.db.prepare(`
      SELECT
        id,
        kind,
        canonical_uri,
        display_label,
        sensitivity,
        first_seen_at_ms,
        last_seen_at_ms
      FROM resources
      WHERE id = ?
    `).get(id) as {
      id: number
      kind: ResourceIdentity['kind']
      canonical_uri: string
      display_label: string | null
      sensitivity: 'normal' | 'protected'
      first_seen_at_ms: number
      last_seen_at_ms: number
    } | undefined

    if (!row) return undefined

    return {
      id: row.id as ResourceId,
      kind: row.kind,
      canonicalUri: row.canonical_uri,
      ...(row.display_label ? { displayLabel: row.display_label } : {}),
      sensitivity: row.sensitivity,
      firstSeenAtMs: row.first_seen_at_ms,
      lastSeenAtMs: row.last_seen_at_ms,
    }
  }
}
