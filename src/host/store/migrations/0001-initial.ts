import type { DatabaseSync } from 'node:sqlite'

export const migration0001 = {
  version: 1,
  name: 'initial',
  checksum: '2026-10-01-initial-v1',

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at_ms INTEGER NOT NULL
      );

      CREATE TABLE resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('file','directory','url','document','workspace')),
        canonical_uri TEXT NOT NULL,
        display_label TEXT,
        sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','protected')),
        first_seen_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        UNIQUE(kind, canonical_uri)
      );
      CREATE INDEX resources_last_seen_idx ON resources(last_seen_at_ms DESC);

      CREATE TABLE observations (
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
        workspace_source TEXT NOT NULL CHECK (workspace_source IN ('dsh','git','filesystem','none')),
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
      CREATE INDEX observations_time_idx ON observations(observed_at_ms DESC);
      CREATE INDEX observations_expiry_idx ON observations(expires_at_ms);
      CREATE INDEX observations_bundle_idx ON observations(bundle_id, observed_at_ms DESC);
      CREATE INDEX observations_workspace_idx ON observations(workspace_id, observed_at_ms DESC);
      CREATE INDEX observations_resource_idx ON observations(resource_id, observed_at_ms DESC);

      CREATE TABLE episodes (
        id TEXT PRIMARY KEY,
        started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER NOT NULL,
        start_reason TEXT NOT NULL,
        end_reason TEXT NOT NULL,
        primary_workspace_id TEXT,
        primary_workspace_root TEXT,
        primary_workspace_title TEXT,
        thread_key TEXT,
        last_strong_resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
        summary_kind TEXT NOT NULL CHECK (summary_kind IN ('deterministic','model')),
        summary_text TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
        state TEXT NOT NULL CHECK (state IN ('open','closed','invalidated')),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER
      );
      CREATE INDEX episodes_recent_idx ON episodes(ended_at_ms DESC);
      CREATE INDEX episodes_workspace_idx ON episodes(primary_workspace_id, ended_at_ms DESC);
      CREATE INDEX episodes_thread_idx ON episodes(thread_key, ended_at_ms DESC);
      CREATE INDEX episodes_expiry_idx ON episodes(expires_at_ms);

      CREATE TABLE episode_observations (
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
        PRIMARY KEY(episode_id, observation_id)
      );

      CREATE TABLE episode_resources (
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        first_seen_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        observation_count INTEGER NOT NULL,
        PRIMARY KEY(episode_id, resource_id)
      );

      CREATE TABLE episode_surfaces (
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        bundle_id TEXT NOT NULL,
        surface_kind TEXT NOT NULL,
        first_seen_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        observation_count INTEGER NOT NULL,
        PRIMARY KEY(episode_id, bundle_id, surface_kind)
      );

      CREATE TABLE policy_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        revision INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('include-only','exclude')),
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE policy_rules (
        id TEXT PRIMARY KEY,
        dimension TEXT NOT NULL CHECK (dimension IN ('app','resource')),
        action TEXT NOT NULL CHECK (action IN ('allow','deny','protect')),
        matcher TEXT NOT NULL CHECK (matcher IN ('exact','prefix','glob')),
        pattern TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0,1)),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE deletion_log (
        id TEXT PRIMARY KEY,
        requested_at_ms INTEGER NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('time-range','episode','app','all')),
        range_start_ms INTEGER,
        range_end_ms INTEGER,
        bundle_id TEXT,
        observations_deleted INTEGER NOT NULL,
        episodes_deleted INTEGER NOT NULL,
        episodes_rebuilt INTEGER NOT NULL
      );
    `)
  },
} as const
