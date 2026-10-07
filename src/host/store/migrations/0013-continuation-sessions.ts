import type { DatabaseSync } from 'node:sqlite'

/**
 * Bind an opaque DSH Session to the exact Episode selected by Continue.
 * The composer/transcript can therefore stay identifier-free.
 */
export const migration0013 = {
  version: 13,
  name: 'continuation-sessions',
  checksum: '2026-10-06-continuation-sessions-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE continuation_sessions (
        session_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        bound_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );

      CREATE INDEX continuation_sessions_episode_idx
        ON continuation_sessions(episode_id);
      CREATE INDEX continuation_sessions_expiry_idx
        ON continuation_sessions(expires_at_ms);
    `)
  },
} as const
