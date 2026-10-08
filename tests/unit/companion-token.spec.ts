import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompanionTokenStore } from '../../src/host/companion/token-store.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function store(): { db: ReturnType<typeof openHistoryDatabase>; tokens: CompanionTokenStore } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-pairing-'))
  roots.push(root)
  const history = openHistoryDatabase({ dataDirectory: path.join(root, 'history'), nowMs: 1 })
  return { db: history, tokens: new CompanionTokenStore(history.db) }
}

describe('companion pairing tokens', () => {
  it('keeps browser and editor credentials independent', () => {
    const { tokens } = store()
    expect(tokens.state('browser')).toEqual({ paired: false })
    expect(tokens.state('editor')).toEqual({ paired: false })

    const browser = tokens.rotate('browser', 1_000)
    const editor = tokens.rotate('editor', 2_000)
    expect(browser).not.toBe(editor)
    expect(tokens.verify('browser', browser)).toBe(true)
    expect(tokens.verify('browser', editor)).toBe(false)
    expect(tokens.verify('editor', editor)).toBe(true)
    expect(tokens.verify('editor', browser)).toBe(false)
    expect(tokens.state('browser')).toEqual({ paired: true, createdAtMs: 1_000 })
    expect(tokens.state('editor')).toEqual({ paired: true, createdAtMs: 2_000 })
  })

  it('stores digests, never either token itself', () => {
    const { db, tokens } = store()
    const browser = tokens.rotate('browser', 2_000)
    const editor = tokens.rotate('editor', 3_000)
    const rows = db.db.prepare(`
      SELECT kind, token_hash FROM companion_pairing ORDER BY kind
    `).all() as Array<{ kind: string; token_hash: string }>
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(row.token_hash).not.toContain(browser)
      expect(row.token_hash).not.toContain(editor)
    }
  })

  it('rotating one kind does not invalidate the other', () => {
    const { tokens } = store()
    const browser = tokens.rotate('browser', 1_000)
    const editorFirst = tokens.rotate('editor', 1_500)
    const editorSecond = tokens.rotate('editor', 2_000)
    expect(tokens.verify('browser', browser)).toBe(true)
    expect(tokens.verify('editor', editorFirst)).toBe(false)
    expect(tokens.verify('editor', editorSecond)).toBe(true)
    expect(tokens.state('browser').createdAtMs).toBe(1_000)
    expect(tokens.state('editor').createdAtMs).toBe(2_000)
  })

  it('refreshes cached credentials when another Host rotates the shared token', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-pairing-multi-host-'))
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const first = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const second = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const hostA = new CompanionTokenStore(first.db)
    const hostB = new CompanionTokenStore(second.db)

    const firstToken = hostA.rotate('browser', 1_000)
    expect(hostB.verify('browser', firstToken)).toBe(true)

    const replacement = hostB.rotate('browser', 2_000)
    expect(hostA.verify('browser', firstToken)).toBe(false)
    expect(hostA.verify('browser', replacement)).toBe(true)
    expect(hostA.state('browser')).toEqual({
      paired: true,
      createdAtMs: 2_000,
    })

    first.close()
    second.close()
  })

  it('does not let a stale compensation overwrite a newer Host rotation', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-pairing-compensate-'))
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const first = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const second = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const hostA = new CompanionTokenStore(first.db)
    const hostB = new CompanionTokenStore(second.db)

    const original = hostA.rotate('editor', 1_000)
    const checkpoint = hostA.checkpoint('editor')
    const attempted = hostA.rotate('editor', 2_000)

    // Another Host completes a legitimate rotation before A discovers that
    // its filesystem publication failed.
    const winner = hostB.rotate('editor', 3_000)

    expect(hostA.restore('editor', checkpoint, attempted)).toBe(false)
    expect(hostA.verify('editor', original)).toBe(false)
    expect(hostA.verify('editor', attempted)).toBe(false)
    expect(hostA.verify('editor', winner)).toBe(true)
    expect(hostA.state('editor')).toEqual({
      paired: true,
      createdAtMs: 3_000,
    })

    first.close()
    second.close()
  })

  it('retries a pairing snapshot if another Host rotates between row read and data-version read', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-pairing-snapshot-race-'))
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const first = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const second = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const hostB = new CompanionTokenStore(second.db)
    const oldToken = hostB.rotate('browser', 1_000)
    const hostA = new CompanionTokenStore(first.db)
    expect(hostA.verify('browser', oldToken)).toBe(true)

    // Force B's write precisely between A's SELECT and its second
    // data_version read. Old code would cache the old token and the new
    // version, falsely continuing to accept a revoked credential.
    const internal = hostA as unknown as {
      dataVersion: () => number
      reloadCredentials: () => void
    }
    const actualVersion = internal.dataVersion.bind(hostA)
    let reads = 0
    let replacement = ''
    internal.dataVersion = () => {
      if (++reads === 2) replacement = hostB.rotate('browser', 2_000)
      return actualVersion()
    }
    internal.reloadCredentials()
    expect(reads).toBeGreaterThanOrEqual(4)
    expect(hostA.verify('browser', oldToken)).toBe(false)
    expect(hostA.verify('browser', replacement)).toBe(true)
    expect(hostA.state('browser').createdAtMs).toBe(2_000)

    first.close()
    second.close()
  })

  it('survives a reopen of the store', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-pairing-reopen-'))
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const first = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const store1 = new CompanionTokenStore(first.db)
    const browser = store1.rotate('browser', 5_000)
    const editor = store1.rotate('editor', 6_000)
    first.close()

    const second = openHistoryDatabase({ dataDirectory, nowMs: 2 })
    const tokens = new CompanionTokenStore(second.db)
    expect(tokens.verify('browser', browser)).toBe(true)
    expect(tokens.verify('editor', editor)).toBe(true)
    expect(tokens.state('browser')).toEqual({ paired: true, createdAtMs: 5_000 })
    expect(tokens.state('editor')).toEqual({ paired: true, createdAtMs: 6_000 })
    second.close()
  })
})
