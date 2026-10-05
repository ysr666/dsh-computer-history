import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const EDITOR_BOOTSTRAP_FILENAME = 'editor-companion-bootstrap.json'
export const EDITOR_BOOTSTRAP_TTL_MS = 5 * 60_000

export interface EditorCompanionBootstrap {
  readonly v: 1
  readonly port: number
  readonly token: string
  readonly expiresAtMs: number
}

export function editorCompanionBootstrapPath(
  homeDirectory = os.homedir(),
): string {
  return path.join(
    homeDirectory,
    '.dsh',
    'computer-history',
    EDITOR_BOOTSTRAP_FILENAME,
  )
}

/**
 * Stage a short-lived credential for the editor extension to consume once.
 *
 * The long-lived Host store still persists only a digest. Cleartext exists only
 * in this 0600 handoff file until the editor consumes and deletes it, matching
 * the existing fact that the companion itself must possess the token in clear.
 */
export function stageEditorCompanionBootstrap(input: {
  readonly port: number
  readonly token: string
  readonly nowMs?: number
  readonly homeDirectory?: string
}): EditorCompanionBootstrap {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new Error('editor companion bootstrap requires a valid loopback port')
  }
  if (input.token.length < 32) {
    throw new Error('editor companion bootstrap requires a pairing token')
  }
  const nowMs = input.nowMs ?? Date.now()
  const bootstrap: EditorCompanionBootstrap = {
    v: 1,
    port: input.port,
    token: input.token,
    expiresAtMs: nowMs + EDITOR_BOOTSTRAP_TTL_MS,
  }
  const target = editorCompanionBootstrapPath(input.homeDirectory)
  const directory = path.dirname(target)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)

  const temporary = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(bootstrap)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    chmodSync(temporary, 0o600)
    renameSync(temporary, target)
    chmodSync(target, 0o600)
  } finally {
    rmSync(temporary, { force: true })
  }
  return bootstrap
}
