import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { EpisodeId } from '../../src/shared/index.js'
import { latestSchemaVersion } from '../../src/host/store/index.js'
import {
  EpisodeStore,
  ObservationStore,
  openHistoryDatabase,
  PolicyStore,
} from '../../src/host/store/index.js'

const roots: string[] = []

const V1_SCHEMA = `
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
`

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('v1 database upgrade compatibility', () => {
  it('upgrades a frozen v1 fixture without losing history', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-upgrade-'))
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    mkdirSync(dataDirectory, { recursive: true })
    const oldDb = new DatabaseSync(
      path.join(dataDirectory, 'history.sqlite'),
    )
    oldDb.exec('PRAGMA foreign_keys = ON')
    oldDb.exec(V1_SCHEMA)
    oldDb.prepare(`
      INSERT INTO schema_migrations(
        version, name, checksum, applied_at_ms
      ) VALUES (1, 'initial', '2026-10-01-initial-v1', 100)
    `).run()
    oldDb.exec('PRAGMA user_version = 1')

    oldDb.prepare(`
      INSERT INTO policy_state(
        singleton, revision, mode, updated_at_ms
      ) VALUES (1, 2, 'include-only', 110)
    `).run()
    oldDb.prepare(`
      INSERT INTO policy_rules(
        id, dimension, action, matcher, pattern,
        built_in, created_at_ms, updated_at_ms
      ) VALUES (
        'allow-code', 'app', 'allow', 'exact',
        'com.microsoft.VSCode', 0, 100, 100
      )
    `).run()

    const resourceResult = oldDb.prepare(`
      INSERT INTO resources(
        kind, canonical_uri, display_label, sensitivity,
        first_seen_at_ms, last_seen_at_ms
      ) VALUES ('file', ?, 'provider.ts', 'normal', 1000, 1000)
    `).run('file:///alpha/src/provider.ts')
    const resourceId = Number(resourceResult.lastInsertRowid)

    const observationResult = oldDb.prepare(`
      INSERT INTO observations(
        collector_session, collector_seq, observed_at_ms,
        pid, bundle_id, surface_kind, resource_id,
        workspace_id, workspace_root, workspace_title,
        workspace_source, workspace_confidence,
        privacy_secure, privacy_protected,
        source_provider, source_adapter,
        policy_revision, expires_at_ms
      ) VALUES (
        'upgrade-session', 1, 1000,
        1, 'com.microsoft.VSCode', 'editor', ?,
        'alpha', '/alpha', 'alpha',
        'dsh', 1,
        0, 0,
        'macos-ax', 'vscode',
        2, 90000000
      )
    `).run(resourceId)
    const observationId = Number(observationResult.lastInsertRowid)
    const episodeId = EpisodeId('episode:upgrade-session:1')

    oldDb.prepare(`
      INSERT INTO episodes(
        id, started_at_ms, ended_at_ms,
        start_reason, end_reason,
        primary_workspace_id, primary_workspace_root,
        primary_workspace_title, thread_key,
        last_strong_resource_id,
        summary_kind, summary_text, confidence, state,
        created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES (
        ?, 1000, 1000,
        'first-observation', 'timeout',
        'alpha', '/alpha', 'alpha', 'workspace:alpha',
        ?,
        'deterministic', 'Worked in alpha.', 1, 'closed',
        2000, 2000, 90000000
      )
    `).run(episodeId, resourceId)
    oldDb.prepare(`
      INSERT INTO episode_observations(
        episode_id, observation_id
      ) VALUES (?, ?)
    `).run(episodeId, observationId)
    oldDb.prepare(`
      INSERT INTO episode_resources(
        episode_id, resource_id,
        first_seen_at_ms, last_seen_at_ms, observation_count
      ) VALUES (?, ?, 1000, 1000, 1)
    `).run(episodeId, resourceId)
    oldDb.prepare(`
      INSERT INTO episode_surfaces(
        episode_id, bundle_id, surface_kind,
        first_seen_at_ms, last_seen_at_ms, observation_count
      ) VALUES (?, 'com.microsoft.VSCode', 'editor', 1000, 1000, 1)
    `).run(episodeId)
    oldDb.close()

    const upgraded = openHistoryDatabase({ dataDirectory, nowMs: 999 })
    expect(new ObservationStore(upgraded.db).count()).toBe(1)

    // Coverage of the *latest* schema, computed from the migrations themselves:
    // a hardcoded number here would let a new migration slip past this path.
    const versions = readdirSync(path.join(process.cwd(), 'src', 'host', 'store', 'migrations'))
      .filter(name => name.endsWith('.ts'))
      .map(name => Number(name.slice(0, 4)))
    const latest = Math.max(...versions)
    expect(
      (upgraded.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(latest)
    expect(new EpisodeStore(upgraded.db).get(episodeId)).toMatchObject({
      id: episodeId,
      summary: 'Worked in alpha.',
      observationIds: [observationId],
    })
    expect(new PolicyStore(upgraded.db).get()).toMatchObject({
      revision: 2,
      mode: 'include-only',
    })
    expect(upgraded.db.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations',
    ).get()).toEqual({ count: latestSchemaVersion() })
    // A column added by a later migration has to appear on a database that predates it, and it has to be
    // nullable: the episodes this fixture already holds were summarised before surface titles existed, and
    // nothing invents one for them.
    const surfaceColumns = upgraded.db.prepare(
      'PRAGMA table_info(episode_surfaces)',
    ).all() as Array<{ name: string, notnull: number }>
    expect(surfaceColumns.find(column => column.name === 'title')).toMatchObject({
      name: 'title',
      notnull: 0,
    })
    upgraded.close()
  })
})
