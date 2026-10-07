import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportHistory, importHistory } from '../../src/host/audit/export.js'
import { RetentionService } from '../../src/host/retention/retention-service.js'
import {
  ContinuationSessionStore,
  openHistoryDatabase,
} from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function root(label: string): string {
  const value = mkdtempSync(path.join(os.tmpdir(), `dsh-continuation-${label}-`))
  roots.push(value)
  return value
}

function insertEpisode(db: import('node:sqlite').DatabaseSync, id = 'episode:1'): void {
  db.prepare(`
    INSERT INTO episodes(
      id, started_at_ms, ended_at_ms, start_reason, end_reason,
      summary_kind, summary_text, confidence, state,
      created_at_ms, updated_at_ms, expires_at_ms
    ) VALUES (?, 10, 20, 'first-observation', 'timeout',
      'deterministic', 'fixture', 1.0, 'closed', 20, 20, NULL)
  `).run(id)
}

describe('Continue capsule session bindings', () => {
  it('survives a Host reopen while storing only session/Episode metadata', () => {
    const dataDirectory = root('reopen')
    const first = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    insertEpisode(first.db)
    const bindings = new ContinuationSessionStore(first.db)
    bindings.bind({
      sessionId: 'session:new',
      episodeId: 'episode:1' as never,
    }, 100, 10_000)
    first.close()

    const second = openHistoryDatabase({ dataDirectory, nowMs: 200 })
    expect(new ContinuationSessionStore(second.db).episodeForSession(
      'session:new',
      200,
    )).toBe('episode:1')
    const row = second.db.prepare(
      'SELECT * FROM continuation_sessions WHERE session_id = ?',
    ).get('session:new')
    expect(JSON.stringify(row)).not.toContain('prompt')
    expect(JSON.stringify(row)).not.toContain('Git')
    expect(JSON.stringify(row)).not.toContain('summary')
    second.close()
  })

  it('round-trips with history export and disappears when its Episode is deleted', () => {
    const sourceRoot = root('export-source')
    const source = openHistoryDatabase({ dataDirectory: sourceRoot, nowMs: 1 })
    insertEpisode(source.db)
    new ContinuationSessionStore(source.db).bind({
      sessionId: 'session:new',
      episodeId: 'episode:1' as never,
    }, 100, 10_000)

    const document = exportHistory(source.db, 200)
    expect(document.tables.continuation_sessions).toHaveLength(1)

    const targetRoot = root('export-target')
    const target = openHistoryDatabase({ dataDirectory: targetRoot, nowMs: 1 })
    expect(importHistory(target.db, document).imported.continuation_sessions).toBe(1)
    const bindings = new ContinuationSessionStore(target.db)
    expect(bindings.episodeForSession('session:new', 200)).toBe('episode:1')

    target.db.prepare('DELETE FROM episodes WHERE id = ?').run('episode:1')
    expect(bindings.episodeForSession('session:new', 200)).toBeUndefined()

    source.close()
    target.close()
  })

  it('removes one failed continuation binding without touching its Episode', () => {
    const dataDirectory = root('unbind')
    const handle = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    insertEpisode(handle.db)
    const bindings = new ContinuationSessionStore(handle.db)
    bindings.bind({
      sessionId: 'session:new',
      episodeId: 'episode:1' as never,
    }, 100, 10_000)

    expect(bindings.deleteSession('session:new')).toBe(true)
    expect(bindings.deleteSession('session:new')).toBe(false)
    expect(bindings.episodeForSession('session:new', 200)).toBeUndefined()
    expect(handle.db.prepare(
      'SELECT COUNT(*) AS count FROM episodes WHERE id = ?',
    ).get('episode:1')).toEqual({ count: 1 })
    handle.close()
  })

  it('expires under the ordinary retention sweep', () => {
    const dataDirectory = root('expiry')
    const handle = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    insertEpisode(handle.db)
    const bindings = new ContinuationSessionStore(handle.db)
    bindings.bind({
      sessionId: 'session:new',
      episodeId: 'episode:1' as never,
    }, 100, 150)

    new RetentionService(handle.db).sweep(200)
    expect(bindings.episodeForSession('session:new', 200)).toBeUndefined()
    handle.close()
  })
})
