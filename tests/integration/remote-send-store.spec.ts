import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RemoteSendStore } from '../../src/host/semantic/send-store.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function database() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-sends-'))
  roots.push(root)
  return openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
}

function episodeRow(db: ReturnType<typeof database>['db'], id: string): void {
  const now = 1
  db.prepare(`INSERT INTO episodes(id, started_at_ms, ended_at_ms, start_reason,
    end_reason, summary_kind, summary_text, confidence, state, created_at_ms,
    updated_at_ms) VALUES (?, ?, ?, 'first-observation', 'timeout',
    'deterministic', 'text', 0.5, 'closed', ?, ?)`).run(id, now, now, now, now)
}

describe('the record of what left the machine (ADR 0010)', () => {
  it('records a send and reads it back without any content', () => {
    const { db, close } = database()
    episodeRow(db, 'ep-1')
    const sends = new RemoteSendStore(db)

    const id = sends.record({
      episodeId: 'ep-1',
      scopeKey: 'workspace:w1',
      endpointHost: 'models.example.test',
      model: 'remote-model',
      payloadDigest: 'a'.repeat(64),
      sentAtMs: 5_000,
    })

    expect(id).toBeGreaterThan(0)
    const rows = sends.listForScope('workspace:w1')
    expect(rows).toEqual([{
      id,
      episodeId: 'ep-1',
      scopeKey: 'workspace:w1',
      endpointHost: 'models.example.test',
      model: 'remote-model',
      payloadDigest: 'a'.repeat(64),
      sentAtMs: 5_000,
    }])
    // No column carries the payload or the summary: the record cannot become a
    // second place the data lives.
    const columns = db.prepare('PRAGMA table_info(remote_summary_sends)')
      .all() as Array<{ name: string }>
    expect(columns.map(column => column.name).toSorted()).toEqual([
      'endpoint_host', 'episode_id', 'id', 'model', 'payload_digest',
      'scope_key', 'sent_at_ms',
    ])
    close()
  })

  it('keeps the fact of a send when the episode is deleted, and drops the link', () => {
    const { db, close } = database()
    episodeRow(db, 'ep-1')
    const sends = new RemoteSendStore(db)
    sends.record({
      episodeId: 'ep-1',
      scopeKey: 'workspace:w1',
      endpointHost: 'models.example.test',
      model: 'm',
      payloadDigest: 'b'.repeat(64),
      sentAtMs: 1,
    })

    db.prepare('DELETE FROM episodes WHERE id = ?').run('ep-1')

    // The audit question "did anything ever leave for this scope?" survives the
    // deletion of what it was about; the link to a gone episode does not.
    const rows = sends.listForScope('workspace:w1')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.episodeId).toBeUndefined()
    close()
  })

  it('forgets the scope entirely when the opt-in is revoked', () => {
    const { db, close } = database()
    const sends = new RemoteSendStore(db)
    for (const scope of ['workspace:w1', 'workspace:w2']) {
      sends.record({
        scopeKey: scope,
        endpointHost: 'models.example.test',
        model: 'm',
        payloadDigest: 'c'.repeat(64),
        sentAtMs: 1,
      })
    }

    expect(sends.deleteForScope('workspace:w1')).toBe(1)
    expect(sends.listForScope('workspace:w1')).toEqual([])
    // The other scope is untouched: revocation is per scope, as consent was.
    expect(sends.listForScope('workspace:w2')).toHaveLength(1)
    close()
  })
})

describe('revoking a scope forgets what left for it (ADR 0010)', () => {
  it('deletes the send records of that scope and leaves others alone', () => {
    const { db, close } = database()
    const sends = new RemoteSendStore(db)
    sends.record({
      scopeKey: 'workspace:w1', endpointHost: 'models.example.test',
      model: 'm', payloadDigest: 'd'.repeat(64), sentAtMs: 1,
    })
    sends.record({
      scopeKey: 'workspace:w2', endpointHost: 'models.example.test',
      model: 'm', payloadDigest: 'e'.repeat(64), sentAtMs: 2,
    })

    // What LocalBackend.revokeSemanticOptIn does after revoking the opt-in.
    const forgotten = sends.deleteForScope('workspace:w1')

    expect(forgotten).toBe(1)
    expect(sends.listForScope('workspace:w1')).toEqual([])
    expect(sends.listForScope('workspace:w2')).toHaveLength(1)
    close()
  })
})
