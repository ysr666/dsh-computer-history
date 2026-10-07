import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimPendingBootstrap,
  editorBootstrapPath,
  finishBootstrapClaim,
  restoreBootstrapClaim,
} from '../src/bootstrap'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function home(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-editor-consume-'))
  roots.push(root)
  return root
}

function publish(
  homeDirectory: string,
  token: string,
  expiresAtMs = 10_000,
): string {
  const target = editorBootstrapPath(homeDirectory)
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  chmodSync(path.dirname(target), 0o700)
  writeFileSync(target, JSON.stringify({
    v: 1,
    port: 19388,
    token,
    expiresAtMs,
  }) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(target, 0o600)
  return target
}

describe('editor bootstrap consumption', () => {
  it('cannot delete a newer Host publication after claiming an older one', () => {
    const root = home()
    const tokenA = 'A'.repeat(43)
    const tokenB = 'B'.repeat(43)
    const target = publish(root, tokenA)

    const claimedA = claimPendingBootstrap(() => {}, root, 1_000)
    expect(claimedA?.value.token).toBe(tokenA)
    expect(existsSync(target)).toBe(false)

    // Host B publishes while A is asynchronously moving its token into
    // SecretStorage. A must only delete the file it already claimed.
    publish(root, tokenB)
    finishBootstrapClaim(claimedA!)

    expect(existsSync(claimedA!.path)).toBe(false)
    expect(JSON.parse(readFileSync(target, 'utf8')).token).toBe(tokenB)
  })

  it('restores the claimed handoff when durable editor storage fails and no newer Host won', () => {
    const root = home()
    const tokenA = 'A'.repeat(43)
    const target = publish(root, tokenA)

    const claimedA = claimPendingBootstrap(() => {}, root, 1_000)
    expect(claimedA).toBeDefined()
    restoreBootstrapClaim(claimedA!)

    expect(existsSync(claimedA!.path)).toBe(false)
    expect(JSON.parse(readFileSync(target, 'utf8')).token).toBe(tokenA)
  })

  it('never restores an older claim over a newer Host publication', () => {
    const root = home()
    const tokenA = 'A'.repeat(43)
    const tokenB = 'B'.repeat(43)
    const target = publish(root, tokenA)

    const claimedA = claimPendingBootstrap(() => {}, root, 1_000)
    expect(claimedA).toBeDefined()
    publish(root, tokenB)

    restoreBootstrapClaim(claimedA!)

    expect(existsSync(claimedA!.path)).toBe(false)
    expect(JSON.parse(readFileSync(target, 'utf8')).token).toBe(tokenB)
  })
})
