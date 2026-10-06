import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompanionTokenStore } from '../../src/host/companion/token-store.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'
import {
  EDITOR_BOOTSTRAP_TTL_MS,
  editorCompanionBootstrapPath,
  rotateAndStageEditorCompanionBootstrap,
  stageEditorCompanionBootstrap,
} from '../../src/host/companion/editor-bootstrap.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('editor companion bootstrap', () => {
  it('stages a bounded one-time credential in the user-owned history directory', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'dsh-editor-bootstrap-'))
    roots.push(home)
    const token = 'x'.repeat(43)
    const staged = stageEditorCompanionBootstrap({
      homeDirectory: home,
      port: 19388,
      token,
      nowMs: 1_000,
    })

    expect(staged).toEqual({
      v: 1,
      port: 19388,
      token,
      expiresAtMs: 1_000 + EDITOR_BOOTSTRAP_TTL_MS,
    })
    const target = editorCompanionBootstrapPath(home)
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(staged)
    if (process.platform !== 'win32') {
      expect(statSync(target).mode & 0o777).toBe(0o600)
      expect(statSync(path.dirname(target)).mode & 0o777).toBe(0o700)
    }
  })

  it('restores the previous editor credential when bootstrap publication fails', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-editor-bootstrap-rollback-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const tokens = new CompanionTokenStore(history.db)
    const previous = tokens.rotate('editor', 1_000)

    expect(() => rotateAndStageEditorCompanionBootstrap({
      tokens,
      port: 19388,
      nowMs: 2_000,
      stage: () => {
        throw new Error('forced bootstrap failure')
      },
    })).toThrow(/forced bootstrap failure/)

    expect(tokens.verify('editor', previous)).toBe(true)
    expect(tokens.state('editor')).toEqual({
      paired: true,
      createdAtMs: 1_000,
    })

    // The compensation is durable, not merely an in-memory repair.
    const reopened = new CompanionTokenStore(history.db)
    expect(reopened.verify('editor', previous)).toBe(true)
    history.close()
  })

  it('refuses invalid ports and implausibly short credentials', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'dsh-editor-bootstrap-'))
    roots.push(home)
    expect(() => stageEditorCompanionBootstrap({
      homeDirectory: home,
      port: 0,
      token: 'x'.repeat(43),
    })).toThrow(/valid loopback port/)
    expect(() => stageEditorCompanionBootstrap({
      homeDirectory: home,
      port: 19388,
      token: 'short',
    })).toThrow(/pairing token/)
  })
})
