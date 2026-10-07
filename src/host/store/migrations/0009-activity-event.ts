import type { DatabaseSync } from 'node:sqlite'

/**
 * Persist the tiny, closed vocabulary of editor activity facts that improve
 * work continuity without reading document content. `save` is currently the
 * only event; ordinary focus/activity observations keep NULL.
 */
export const migration0009 = {
  version: 9,
  name: 'activity-event',
  checksum: '2026-10-06-activity-event-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      ALTER TABLE observations
      ADD COLUMN activity_event TEXT
      CHECK (activity_event IS NULL OR activity_event = 'save');

      CREATE INDEX observations_activity_event_idx
      ON observations(activity_event, observed_at_ms DESC);
    `)
  },
} as const
