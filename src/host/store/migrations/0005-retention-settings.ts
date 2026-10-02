import type { DatabaseSync } from 'node:sqlite'

/**
 * A retention choice the user made, stored rather than configured.
 *
 * It decides the TTL stamped on what the Host records **from now on**: the
 * sweep deletes by the `expires_at_ms` written at insert time, so shortening the
 * window does not reach back and delete history the user did not ask to delete.
 * That difference is stated in the panel next to the control.
 */
export const migration0005 = {
  version: 5,
  name: 'retention-settings',
  checksum: '2026-10-02-retention-settings-v1',
  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE retention_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        observation_retention_hours INTEGER NOT NULL
          CHECK(observation_retention_hours BETWEEN 1 AND 720),
        episode_retention_days INTEGER NOT NULL
          CHECK(episode_retention_days BETWEEN 1 AND 365),
        updated_at_ms INTEGER NOT NULL
      );
    `)
  },
}
