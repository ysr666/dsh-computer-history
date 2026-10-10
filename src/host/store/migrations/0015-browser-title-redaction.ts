import type { DatabaseSync } from 'node:sqlite'
import { rederiveBrowserEpisodeSummaries } from '../../episodes/browser-title-privacy.js'

/**
 * Earlier Hosts stripped query/fragment but could preserve HTTP user-info in
 * resource canonicalUri. Merge identities safely when normalization collides.
 * Existing references, Episode citations and timestamps are preserved.
 */
function stripStoredBrowserUrlCredentials(db: DatabaseSync): void {
  const rows = db.prepare(
    "SELECT id, canonical_uri FROM resources WHERE kind = 'url' ORDER BY id",
  ).all() as Array<{ id: number; canonical_uri: string }>
  const find = db.prepare(
    "SELECT id FROM resources WHERE kind='url' AND canonical_uri=?",
  )
  for (const row of rows) {
    let safe = 'https://redacted.invalid/'
    try {
      const u = new URL(row.canonical_uri)
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        u.username = ''
        u.password = ''
        u.search = ''
        u.hash = ''
        safe = u.href
      }
    } catch { /* malformed legacy URI is redacted rather than retained */ }
    if (safe === row.canonical_uri) continue

    const existing = find.get(safe) as { id: number } | undefined
    if (!existing || existing.id === row.id) {
      db.prepare('UPDATE resources SET canonical_uri=? WHERE id=?')
        .run(safe, row.id)
      continue
    }
    const dest = existing.id
    db.prepare(`
      INSERT INTO episode_resources(
        episode_id, resource_id, first_seen_at_ms, last_seen_at_ms,
        observation_count
      )
      SELECT episode_id, ?, first_seen_at_ms, last_seen_at_ms, observation_count
      FROM episode_resources WHERE resource_id=?
      ON CONFLICT(episode_id, resource_id) DO UPDATE SET
        first_seen_at_ms=MIN(first_seen_at_ms, excluded.first_seen_at_ms),
        last_seen_at_ms=MAX(last_seen_at_ms, excluded.last_seen_at_ms),
        observation_count=observation_count + excluded.observation_count
    `).run(dest, row.id)
    db.prepare('UPDATE observations SET resource_id=? WHERE resource_id=?')
      .run(dest, row.id)
    db.prepare('UPDATE episodes SET last_strong_resource_id=? WHERE last_strong_resource_id=?')
      .run(dest, row.id)
    db.prepare('DELETE FROM episode_resources WHERE resource_id=?').run(row.id)
    db.prepare(`
      UPDATE resources SET
        first_seen_at_ms=MIN(first_seen_at_ms,
          (SELECT first_seen_at_ms FROM resources WHERE id=?)),
        last_seen_at_ms=MAX(last_seen_at_ms,
          (SELECT last_seen_at_ms FROM resources WHERE id=?))
      WHERE id=?
    `).run(row.id, row.id, dest)
    db.prepare('DELETE FROM resources WHERE id=?').run(row.id)
  }
}

/** Migration 15 removes free-form browser titles from historical metadata. */
export const migration0015 = {
  version: 15,
  name: 'browser-title-privacy-redaction',
  checksum: '2026-10-10-browser-title-redaction-v1',

  up(db: DatabaseSync): void {
    db.prepare("UPDATE resources SET display_label = NULL WHERE kind = 'url'").run()
    db.prepare("UPDATE observations SET window_title = NULL WHERE surface_kind = 'browser' OR source_adapter = 'browser'").run()
    stripStoredBrowserUrlCredentials(db)
    rederiveBrowserEpisodeSummaries(db)
  },
} as const
