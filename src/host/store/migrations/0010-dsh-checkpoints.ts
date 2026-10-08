import type { DatabaseSync } from 'node:sqlite'

/**
 * DSH checkpoints are metadata-only continuity anchors: which top-level DSH
 * session/turn ended in which workspace and when. Conversation text is never
 * stored here.
 */
export const migration0010 = {
  version: 10,
  name: 'dsh-checkpoints',
  checksum: '2026-10-06-dsh-checkpoints-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE dsh_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn INTEGER NOT NULL CHECK (turn >= 1),
        checkpoint_at_ms INTEGER NOT NULL,
        cwd TEXT,
        workspace_id TEXT,
        workspace_root TEXT,
        workspace_title TEXT,
        expires_at_ms INTEGER NOT NULL,
        UNIQUE(session_id, turn)
      );
      CREATE INDEX dsh_checkpoints_time_idx
        ON dsh_checkpoints(checkpoint_at_ms DESC);
      CREATE INDEX dsh_checkpoints_workspace_id_idx
        ON dsh_checkpoints(workspace_id, checkpoint_at_ms DESC);
      CREATE INDEX dsh_checkpoints_workspace_root_idx
        ON dsh_checkpoints(workspace_root, checkpoint_at_ms DESC);
      CREATE INDEX dsh_checkpoints_expiry_idx
        ON dsh_checkpoints(expires_at_ms);
    `)
  },
} as const
