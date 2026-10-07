import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BOOTSTRAP_FILENAME = 'editor-companion-bootstrap.json'

export type Bootstrap = {
  readonly v: 1
  readonly port: number
  readonly token: string
  readonly expiresAtMs: number
}

export interface ClaimedBootstrap {
  readonly path: string
  readonly targetPath: string
  readonly value: Bootstrap
}

export function editorBootstrapPath(
  homeDirectory?: string,
): string {
  return join(
    homeDirectory ?? homedir(),
    '.dsh',
    'computer-history',
    BOOTSTRAP_FILENAME,
  )
}

/**
 * Atomically take ownership of the currently-published bootstrap before any
 * asynchronous SecretStorage work begins.
 *
 * Host publication also uses rename-to-target. Once this function has renamed
 * A away from the shared target, a later Host may publish B at the original
 * path without A's consumer ever deleting B by mistake.
 */
export function claimPendingBootstrap(
  report: (message: string) => void,
  homeDirectory?: string,
  nowMs = Date.now(),
): ClaimedBootstrap | undefined {
  const target = editorBootstrapPath(homeDirectory)
  const claimed = `${target}.consume-${crypto.randomUUID()}`

  try {
    renameSync(target, claimed)
  } catch {
    return undefined
  }

  let keepClaim = false
  try {
    const stat = statSync(claimed)
    if (
      process.platform !== 'win32'
      && ((stat.mode & 0o077) !== 0
        || (typeof process.getuid === 'function'
          && stat.uid !== process.getuid()))
    ) {
      report('bootstrap ignored: unsafe owner or permissions')
      return undefined
    }

    const parsed = JSON.parse(
      readFileSync(claimed, 'utf8'),
    ) as Partial<Bootstrap>
    if (
      parsed.v !== 1
      || !Number.isInteger(parsed.port)
      || Number(parsed.port) < 1
      || Number(parsed.port) > 65_535
      || typeof parsed.token !== 'string'
      || parsed.token.length < 32
      || typeof parsed.expiresAtMs !== 'number'
    ) {
      report('bootstrap ignored: invalid shape')
      return undefined
    }
    if (parsed.expiresAtMs < nowMs) {
      report('bootstrap ignored: expired')
      return undefined
    }

    keepClaim = true
    return {
      path: claimed,
      targetPath: target,
      value: parsed as Bootstrap,
    }
  } catch {
    return undefined
  } finally {
    if (!keepClaim) {
      try { unlinkSync(claimed) } catch {}
    }
  }
}

export function finishBootstrapClaim(
  bootstrap: ClaimedBootstrap,
): void {
  try { unlinkSync(bootstrap.path) } catch {}
}

/**
 * A SecretStorage/Memento failure should not silently destroy the only copy of
 * a freshly-issued credential. Restore the claimed bytes only when no newer
 * Host publication occupies the shared target. If a newer file exists, it wins
 * and this stale claim is discarded.
 */
export function restoreBootstrapClaim(
  bootstrap: ClaimedBootstrap,
): void {
  if (existsSync(bootstrap.targetPath)) {
    try { unlinkSync(bootstrap.path) } catch {}
    return
  }

  let body: string
  try {
    body = readFileSync(bootstrap.path, 'utf8')
  } catch {
    return
  }

  try {
    writeFileSync(bootstrap.targetPath, body, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    try { unlinkSync(bootstrap.path) } catch {}
  } catch {
    // A concurrent Host may have published between existsSync and writeFileSync.
    // If so, that newer target wins; otherwise leave the claim for diagnostics
    // rather than deleting the only remaining credential handoff.
    if (existsSync(bootstrap.targetPath)) {
      try { unlinkSync(bootstrap.path) } catch {}
    }
  }
}
