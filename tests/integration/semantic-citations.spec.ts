import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { parseScopeKey, SemanticOptInStore } from '../../src/host/semantic/opt-in.js'
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

function insertEpisode(
  db: DatabaseSync,
  id: string,
  kind: string,
  workspaceId?: string,
): void {
  db.prepare(`
    INSERT INTO episodes(
      id, started_at_ms, ended_at_ms, start_reason, end_reason,
      primary_workspace_id, summary_kind, summary_text, confidence, state,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, 1, 2, 'first-observation', 'timeout',
    workspaceId ?? null, kind, 'text', 0.5, 'closed', 1, 1,
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

describe('turn off and purge (ADR 0004, Consequences)', () => {
  it('selects model-written summaries without deleting the underlying Episodes', () => {
    const db = database()
    insertEpisode(db, 'episode-local', 'local', 'w1')
    insertEpisode(db, 'episode-remote', 'remote', 'w1')
    insertEpisode(db, 'episode-plain', 'deterministic', 'w1')

    const optIns = new SemanticOptInStore(db)
    const scope = { kind: 'workspace', id: 'w1' } as const
    expect(optIns.modelEpisodeIds(scope).map(String)).toEqual([
      'episode-local',
      'episode-remote',
    ])
    expect(
      (db.prepare('SELECT id FROM episodes ORDER BY id').all() as Array<{ id: string }>)
        .map(row => row.id),
    ).toEqual([
      'episode-local',
      'episode-plain',
      'episode-remote',
    ])
    db.close()
  })

  it('selects model summaries per scope, not globally', () => {
    const db = database()
    insertEpisode(db, 'episode-a', 'local', 'w1')
    insertEpisode(db, 'episode-b', 'local', 'w2')
    const optIns = new SemanticOptInStore(db)
    expect(
      optIns.modelEpisodeIds({ kind: 'workspace', id: 'w1' }).map(String),
    ).toEqual(['episode-a'])
    expect(
      (db.prepare('SELECT id FROM episodes ORDER BY id').all() as Array<{ id: string }>)
        .map(row => row.id),
    ).toEqual(['episode-a', 'episode-b'])
    db.close()
  })

  it('finds an app model summary after raw provenance has compacted away', () => {
    const db = database()
    insertEpisode(db, 'episode-remote-app', 'remote')
    insertEpisode(db, 'episode-plain-app', 'deterministic')
    for (const episodeId of ['episode-remote-app', 'episode-plain-app']) {
      db.prepare(`
        INSERT INTO episode_surfaces(
          episode_id, bundle_id, surface_kind,
          first_seen_at_ms, last_seen_at_ms, observation_count
        ) VALUES (?, 'com.example.Editor', 'editor', 1, 2, 2)
      `).run(episodeId)
    }

    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM observations',
    ).get()).toEqual({ count: 0 })
    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM episode_observations',
    ).get()).toEqual({ count: 0 })

    const optIns = new SemanticOptInStore(db)
    expect(
      optIns.modelEpisodeIds({
        kind: 'app',
        bundleId: 'com.example.Editor',
      }).map(String),
    ).toEqual(['episode-remote-app'])
    expect(
      (db.prepare('SELECT id FROM episodes ORDER BY id').all() as Array<{ id: string }>)
        .map(row => row.id),
    ).toEqual([
      'episode-plain-app',
      'episode-remote-app',
    ])
    db.close()
  })

  it('refuses a scope key it cannot parse', () => {
    expect(() => parseScopeKey('nonsense')).toThrow(/unrecognised scope key/)
    expect(parseScopeKey('workspace:w1')).toEqual({ kind: 'workspace', id: 'w1' })
    expect(parseScopeKey('app:com.example:extra')).toEqual({
      kind: 'app', bundleId: 'com.example:extra',
    })
  })
})
