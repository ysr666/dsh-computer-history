import type { DatabaseSync } from 'node:sqlite'

/**
 * User-authored persistent notes, never an automatic cache of Episode facts.
 *
 * The Episode locator is intentionally NOT an FK. Retention may expire an
 * Episode without revoking a note explicitly confirmed by the user; explicit
 * Forget uses the separately retained source interval/app anchors instead.
 * These anchors are saved only by the deliberate note-confirmation action.
 */
export const migration0014 = {
  version: 14,
  name: 'user-confirmed-memory',
  checksum: '2026-10-10-user-confirmed-memory-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE memory_projects (
        id TEXT PRIMARY KEY,
        thread_key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE memory_user_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES memory_projects(id) ON DELETE CASCADE,
        note_text TEXT NOT NULL CHECK (length(note_text) BETWEEN 1 AND 1000),
        anchor_episode_id TEXT NOT NULL,
        anchor_started_at_ms INTEGER NOT NULL,
        anchor_ended_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        CHECK (anchor_ended_at_ms >= anchor_started_at_ms)
      );

      CREATE TABLE memory_note_apps (
        note_id TEXT NOT NULL REFERENCES memory_user_notes(id) ON DELETE CASCADE,
        bundle_id TEXT NOT NULL,
        PRIMARY KEY(note_id, bundle_id)
      );

      CREATE INDEX memory_notes_project_idx
        ON memory_user_notes(project_id, created_at_ms DESC);
      CREATE INDEX memory_notes_anchor_idx
        ON memory_user_notes(anchor_episode_id);
      CREATE INDEX memory_notes_source_interval_idx
        ON memory_user_notes(anchor_started_at_ms, anchor_ended_at_ms);
      CREATE INDEX memory_notes_app_idx
        ON memory_note_apps(bundle_id, note_id);
    `)
  },
} as const
