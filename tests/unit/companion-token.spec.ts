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
