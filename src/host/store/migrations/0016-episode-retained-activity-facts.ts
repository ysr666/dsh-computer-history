import type { DatabaseSync } from 'node:sqlite'

/**
 * Episode-retained event facts, not raw observations or copied content.
 *
 * The two tables have exactly the same lifecycle as the Episode. Foreign-key
 * cascades remove them on Episode deletion, including the conservative
 * deletion path when raw evidence has already expired.
 *
 * Backfill only what v15 can still prove from linked raw observations. Do not
 * infer save/test/build activity from filenames or free-form summary text.
 */
export const migration0016 = {
  version: 16,
  name: 'episode-retained-activity-facts',
  checksum: '2026-10-10-episode-retained-activity-facts-v2',

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE episode_saved_resources (
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        first_changed_at_ms INTEGER NOT NULL,
        last_changed_at_ms INTEGER NOT NULL,
        change_count INTEGER NOT NULL CHECK (change_count > 0),
        PRIMARY KEY (episode_id, resource_id)
      );

      CREATE TABLE episode_verification_results (
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        activity_event TEXT NOT NULL CHECK (activity_event IN (
          'verify-build-success', 'verify-build-failure',
          'verify-test-success', 'verify-test-failure',
          'verify-other-success', 'verify-other-failure'
        )),
        first_observed_at_ms INTEGER NOT NULL,
        last_observed_at_ms INTEGER NOT NULL,
        observation_count INTEGER NOT NULL CHECK (observation_count > 0),
        PRIMARY KEY (episode_id, activity_event)
      );

      INSERT INTO episode_saved_resources (
        episode_id, resource_id, first_changed_at_ms, last_changed_at_ms, change_count
      )
      SELECT eo.episode_id, o.resource_id,
        MIN(o.observed_at_ms), MAX(o.observed_at_ms), COUNT(*)
      FROM episode_observations eo
      JOIN observations o ON o.id = eo.observation_id
      WHERE o.activity_event = 'save'
        AND o.resource_id IS NOT NULL
      GROUP BY eo.episode_id, o.resource_id;

      INSERT INTO episode_verification_results (
        episode_id, activity_event, first_observed_at_ms, last_observed_at_ms, observation_count
      )
      SELECT eo.episode_id, o.activity_event,
        MIN(o.observed_at_ms), MAX(o.observed_at_ms), COUNT(*)
      FROM episode_observations eo
      JOIN observations o ON o.id = eo.observation_id
      WHERE o.activity_event IN (
        'verify-build-success', 'verify-build-failure',
        'verify-test-success', 'verify-test-failure',
        'verify-other-success', 'verify-other-failure'
      )
      GROUP BY eo.episode_id, o.activity_event;
    `)
  },
} as const
