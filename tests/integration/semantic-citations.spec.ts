import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function database(): DatabaseSync {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-citations-'))
  roots.push(root)
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  return history.db
}

function insertEpisode(db: DatabaseSync, id: string, kind: string): void {
  db.prepare(`
    INSERT INTO episodes(
      id, started_at_ms, ended_at_ms, start_reason, end_reason,
      summary_kind, summary_text, confidence, state,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, 1, 2, 'first-observation', 'timeout',
    kind, 'text', 0.5, 'closed', 1, 1,
  )
}

describe('semantic provenance in the schema (ADR 0004 §5)', () => {
  it('accepts the provenance vocabulary and refuses anything else', () => {
    const db = database()
    for (const kind of ['deterministic', 'local', 'remote']) {
      insertEpisode(db, `episode-${kind}`, kind)
    }
    expect(() => insertEpisode(db, 'episode-model', 'model'))
      .toThrow(/CHECK constraint failed/)
    db.close()
  })

  it('ties a citation to real evidence', () => {
    const db = database()
    insertEpisode(db, 'episode-1', 'deterministic')
    // The observation does not exist, so the citation cannot: a summary may not
    // claim support from evidence that was never stored.
    expect(() => db.prepare(`
      INSERT INTO episode_summary_citations(episode_id, observation_id)
      VALUES ('episode-1', 999)
    `).run()).toThrow(/FOREIGN KEY constraint failed/)

    // Deleting evidence takes its citation with it, which is what lets
    // deletion invalidate a summary instead of leaving it looking supported.
    db.prepare(`
      INSERT INTO observations(
        id, collector_session, collector_seq, observed_at_ms, pid, bundle_id,
        surface_kind, workspace_source, workspace_confidence,
        privacy_secure, privacy_protected, source_provider, source_adapter,
        policy_revision, expires_at_ms
      ) VALUES (
        1, 'session', 1, 1, 42, 'com.example',
        'editor', 'none', 0,
        0, 0, 'macos-ax', 'vscode',
        1, 999999999
      )
    `).run()
    db.prepare(`
      INSERT INTO episode_summary_citations(episode_id, observation_id)
      VALUES ('episode-1', 1)
    `).run()
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM episode_summary_citations')
        .get(),
    ).toEqual({ count: 1 })

    db.prepare('DELETE FROM observations WHERE id = 1').run()
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM episode_summary_citations')
        .get(),
    ).toEqual({ count: 0 })
    db.close()
  })
})
