import type { DatabaseSync } from 'node:sqlite'

/**
 * What left the machine (ADR 0010).
 *
 * One row per remote request: the endpoint host, the model, when it happened and
 * a digest of the exact bytes. It deliberately holds **no content** - not the
 * payload, not the summary, not a path - so it can survive the deletion of the
 * episode it was about.
 *
 * `episode_id` is therefore `ON DELETE SET NULL`: deleting an episode removes the
 * link because the episode is gone, and keeps the fact that a send happened,
 * which is what an audit needs afterwards. Revoking the opt-in is the opposite
 * instruction and deletes these rows outright (ADR 0010).
 */
export const migration0007 = {
  version: 7,
  name: 'remote-summary-sends',
  checksum: '2026-10-02-remote-summary-sends-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE remote_summary_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
        scope_key TEXT NOT NULL,
        endpoint_host TEXT NOT NULL,
        model TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        sent_at_ms INTEGER NOT NULL
      );

      CREATE INDEX remote_summary_sends_scope_idx
        ON remote_summary_sends(scope_key, sent_at_ms DESC);
      CREATE INDEX remote_summary_sends_episode_idx
        ON remote_summary_sends(episode_id);
    `)
  },
}
