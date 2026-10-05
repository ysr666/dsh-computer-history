import type { DatabaseSync } from 'node:sqlite'

/**
 * The title a surface carried is part of what the timeline says.
 *
 * `observations.window_title` has always stored it, and the episode summary dropped it, so on a platform with
 * no resource to anchor to - Windows, where `resources` is empty on every row - the panel could only say
 * `Notepad.exe · editor` for every Notepad window of the day. The column is nullable and old rows read as
 * absent, which is exactly what they are: nothing is backfilled from the observations they came from, because
 * an episode is a record of what was decided at the time, not a view that can be recomputed later.
 *
 * Adapters that suppress their titles (`suppressesWindowTitle`, terminals) keep contributing none - that rule
 * lives in the ingestion path and is untouched here.
 */
export const migration0009 = {
  version: 9,
  name: 'episode-surface-title',
  checksum: '2026-10-05-episode-surface-title-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      ALTER TABLE episode_surfaces ADD COLUMN title TEXT;
    `)
  },
}
