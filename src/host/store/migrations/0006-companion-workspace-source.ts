import type { DatabaseSync } from 'node:sqlite'

/**
 * A workspace an editor vouched for (ADR 0009).
 *
 * The vocabulary had four values: the Host's own workspace (`dsh`), an
 * inference from a repository or a document path (`git`, `filesystem`), and no
 * workspace at all (`none`). An editor telling the Host where work is happening
 * is none of those, and recording it as `filesystem` would misstate how the
 * Host knows - which is the one thing an audit has to get right.
 *
 * The rebuild is mechanical: `observations` is referenced by
 * `episode_observations`, so dropping it with foreign keys enforced would
 * cascade those rows away. The runner disables the pragma for this migration and
 * checks integrity before committing (`rebuildsReferencedTable`).
 */
export const migration0006 = {
  version: 6,
  name: 'companion-workspace-source',
  checksum: '2026-10-02-companion-workspace-source-v1',
  rebuildsReferencedTable: true,

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE observations_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collector_session TEXT NOT NULL,
        collector_seq INTEGER NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        pid INTEGER NOT NULL,
        bundle_id TEXT NOT NULL,
        app_name TEXT,
        surface_kind TEXT NOT NULL,
        window_title TEXT,
        element_role TEXT,
        element_subrole TEXT,
        element_identifier TEXT,
        element_title TEXT,
        resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
        workspace_id TEXT,
        workspace_root TEXT,
        workspace_title TEXT,
        workspace_source TEXT NOT NULL CHECK (workspace_source IN ('dsh','git','filesystem','companion','none')),
        workspace_confidence REAL NOT NULL CHECK (workspace_confidence >= 0.0 AND workspace_confidence <= 1.0),
        idle_seconds REAL,
        privacy_secure INTEGER NOT NULL CHECK (privacy_secure IN (0,1)),
        privacy_protected INTEGER NOT NULL CHECK (privacy_protected IN (0,1)),
        privacy_reason TEXT,
        source_provider TEXT NOT NULL,
        source_adapter TEXT NOT NULL,
        policy_revision INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        UNIQUE(collector_session, collector_seq)
      );

      INSERT INTO observations_v6 (
        id, collector_session, collector_seq, observed_at_ms, pid, bundle_id,
        app_name, surface_kind, window_title, element_role, element_subrole,
        element_identifier, element_title, resource_id, workspace_id,
        workspace_root, workspace_title, workspace_source,
        workspace_confidence, idle_seconds, privacy_secure, privacy_protected,
        privacy_reason, source_provider, source_adapter, policy_revision,
        expires_at_ms
      )
      SELECT
        id, collector_session, collector_seq, observed_at_ms, pid, bundle_id,
        app_name, surface_kind, window_title, element_role, element_subrole,
        element_identifier, element_title, resource_id, workspace_id,
        workspace_root, workspace_title, workspace_source,
        workspace_confidence, idle_seconds, privacy_secure, privacy_protected,
        privacy_reason, source_provider, source_adapter, policy_revision,
        expires_at_ms
      FROM observations;

      DROP TABLE observations;
      ALTER TABLE observations_v6 RENAME TO observations;

      CREATE INDEX observations_time_idx ON observations(observed_at_ms DESC);
      CREATE INDEX observations_expiry_idx ON observations(expires_at_ms);
      CREATE INDEX observations_bundle_idx ON observations(bundle_id, observed_at_ms DESC);
      CREATE INDEX observations_workspace_idx ON observations(workspace_id, observed_at_ms DESC);
      CREATE INDEX observations_resource_idx ON observations(resource_id, observed_at_ms DESC);
    `)
  },
}
