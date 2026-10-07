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

type BootstrapFs = {
  renameSync(source: string, destination: string): void
  readFileSync(file: string, encoding: 'utf8'): string
  statSync(file: string): { readonly mode: number; readonly uid: number }
  unlinkSync(file: string): void
  writeFileSync(
    file: string,
    data: string,
    options: {
      readonly encoding: 'utf8'
      readonly mode: number
      readonly flag: 'wx'
    },
  ): void
  existsSync(file: string): boolean
}

function fsApi(): BootstrapFs {
  return require('node:fs') as BootstrapFs
}

export function editorBootstrapPath(
  homeDirectory?: string,
): string {
  const os = require('node:os') as { homedir: () => string }
  const path = require('node:path') as {
    join: (...parts: string[]) => string
  }
  return path.join(
    homeDirectory ?? os.homedir(),
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
  const fs = fsApi()
  const target = editorBootstrapPath(homeDirectory)
  const claimed = `${target}.consume-${crypto.randomUUID()}`

  try {
    fs.renameSync(target, claimed)
  } catch {
    return undefined
  }

  let keepClaim = false
  try {
    const stat = fs.statSync(claimed)
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
      fs.readFileSync(claimed, 'utf8'),
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
      try { fs.unlinkSync(claimed) } catch {}
    }
  }
}

export function finishBootstrapClaim(
  bootstrap: ClaimedBootstrap,
): void {
  try { fsApi().unlinkSync(bootstrap.path) } catch {}
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
  const fs = fsApi()
  if (fs.existsSync(bootstrap.targetPath)) {
    try { fs.unlinkSync(bootstrap.path) } catch {}
    return
  }

  let body: string
  try {
    body = fs.readFileSync(bootstrap.path, 'utf8')
  } catch {
    return
  }

  try {
    fs.writeFileSync(bootstrap.targetPath, body, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    try { fs.unlinkSync(bootstrap.path) } catch {}
  } catch {
    // A concurrent Host may have published between existsSync and writeFileSync.
    // If so, that newer target wins; otherwise leave the claim for diagnostics
    // rather than deleting the only remaining credential handoff.
    if (fs.existsSync(bootstrap.targetPath)) {
      try { fs.unlinkSync(bootstrap.path) } catch {}
    }
  }
}
