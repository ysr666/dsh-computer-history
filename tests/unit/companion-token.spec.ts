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

describe('companion pairing token', () => {
  it('is absent until paired and then verifies only the issued token', () => {
    const { tokens } = store()
    expect(tokens.state()).toEqual({ paired: false })
    expect(tokens.verify('anything')).toBe(false)
    expect(tokens.verify(undefined)).toBe(false)

    const token = tokens.rotate(1_000)
    expect(token.length).toBeGreaterThanOrEqual(43) // 32 bytes base64url
    expect(tokens.state()).toEqual({ paired: true, createdAtMs: 1_000 })
    expect(tokens.verify(token)).toBe(true)
    expect(tokens.verify(`${token}x`)).toBe(false)
    expect(tokens.verify(token.slice(0, -1))).toBe(false)
    expect(tokens.verify('')).toBe(false)
  })

  it('stores a digest, never the token itself', () => {
    const { db, tokens } = store()
    const token = tokens.rotate(2_000)
    const row = db.db
      .prepare('SELECT token_hash FROM companion_pairing WHERE id = 1')
      .get() as { token_hash: string }
    expect(row.token_hash).not.toContain(token)
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('invalidates the previous token on rotation', () => {
    const { tokens } = store()
    const first = tokens.rotate(1_000)
    const second = tokens.rotate(2_000)
    expect(second).not.toBe(first)
    expect(tokens.verify(first)).toBe(false)
    expect(tokens.verify(second)).toBe(true)
    expect(tokens.state().createdAtMs).toBe(2_000)
  })

  it('survives a reopen of the store', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-pairing-reopen-'))
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const first = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const token = new CompanionTokenStore(first.db).rotate(5_000)
    first.close()

    const second = openHistoryDatabase({ dataDirectory, nowMs: 2 })
    const tokens = new CompanionTokenStore(second.db)
    expect(tokens.verify(token)).toBe(true)
    expect(tokens.state()).toEqual({ paired: true, createdAtMs: 5_000 })
    second.close()
  })
})
