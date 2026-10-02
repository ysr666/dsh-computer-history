import type { DatabaseSync } from 'node:sqlite'

/**
 * Semantic provenance (ADR 0004 §5).
 *
 * The summary kind grows `local` and `remote` alongside `deterministic`, which
 * SQLite cannot express by altering a CHECK constraint, so `episodes` is
 * rebuilt. A row written by the old `model` value cannot exist (no code path
 * produced one), and the deterministic builder is the only writer, so the
 * rebuild maps it to `deterministic` rather than inventing a model provenance
 * it cannot prove.
 *
 * Citations live in their own table so the database itself enforces the
 * deletion contract: deleting an observation removes the citation, and an
 * episode whose citations are gone can be seen to be unsupported.
 */
export const migration0003 = {
  version: 3,
  name: 'semantic-citations',
  checksum: '2026-10-02-semantic-citations-v1',
  // `episode_observations` and `episode_resources` reference `episodes`, so
  // dropping the old table with foreign keys enforced would cascade their rows
  // away — the rebuild runs with the pragma off and the runner re-checks
  // integrity before committing.
  rebuildsReferencedTable: true,

  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE episodes_v3 (
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
        summary_kind TEXT NOT NULL CHECK (summary_kind IN ('deterministic','local','remote')),
        summary_text TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
        state TEXT NOT NULL CHECK (state IN ('open','closed','invalidated')),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER
      );

      INSERT INTO episodes_v3 (
        id, started_at_ms, ended_at_ms, start_reason, end_reason,
        primary_workspace_id, primary_workspace_root, primary_workspace_title,
        thread_key, last_strong_resource_id, summary_kind, summary_text,
        confidence, state, created_at_ms, updated_at_ms, expires_at_ms
      )
      SELECT
        id, started_at_ms, ended_at_ms, start_reason, end_reason,
        primary_workspace_id, primary_workspace_root, primary_workspace_title,
        thread_key, last_strong_resource_id,
        CASE summary_kind WHEN 'model' THEN 'deterministic' ELSE summary_kind END,
        summary_text, confidence, state, created_at_ms, updated_at_ms, expires_at_ms
      FROM episodes;

      DROP TABLE episodes;
      ALTER TABLE episodes_v3 RENAME TO episodes;

      CREATE INDEX episodes_recent_idx ON episodes(ended_at_ms DESC);
      CREATE INDEX episodes_workspace_idx ON episodes(primary_workspace_id, ended_at_ms DESC);
      CREATE INDEX episodes_thread_idx ON episodes(thread_key, ended_at_ms DESC);
      CREATE INDEX episodes_expiry_idx ON episodes(expires_at_ms);

      CREATE TABLE episode_summary_citations (
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
        PRIMARY KEY (episode_id, observation_id)
      );
      CREATE INDEX episode_summary_citations_observation_idx
        ON episode_summary_citations(observation_id);
    `)
  },
}
