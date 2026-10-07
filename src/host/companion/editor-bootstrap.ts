import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { CompanionTokenStore } from './token-store.js'

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

const EDITOR_BOOTSTRAP_LOCK_WAIT_MS = 5_000

/**
 * Serialise editor credential publication across DSH Host processes.
 *
 * Pairing lives in shared SQLite, while the cleartext handoff lives in one
 * shared file. Failure compensation protects a single publisher, but without an
 * outer cross-process lock two successful Hosts can interleave as:
 * A rotates -> B rotates -> B publishes -> A publishes, leaving SQLite on B
 * while the file contains A. Hold the atomic-write lock across rotate+publish
 * so those two durable surfaces have one total order.
 */
export async function withEditorCompanionPublicationLock<T>(
  work: () => T | Promise<T>,
  homeDirectory = os.homedir(),
): Promise<T> {
  const target = editorCompanionBootstrapPath(homeDirectory)
  const directory = path.dirname(target)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  return withFileLock(
    `${target}.publication`,
    async () => work(),
    { waitMs: EDITOR_BOOTSTRAP_LOCK_WAIT_MS },
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
    // The temporary file is already 0600; rename preserves its mode.
    // Keep rename as the publication point and do nothing fallible afterwards,
    // so a thrown staging operation never leaves a newly-published credential.
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
  return bootstrap
}


/**
 * Rotate the editor credential and publish its cleartext handoff as one user
 * action. Filesystem publication is not part of SQLite, so compensate the
 * credential rotation if staging fails; otherwise a failed install attempt
 * would silently invalidate a previously working editor token.
 */
export function rotateAndStageEditorCompanionBootstrap(input: {
  readonly tokens: CompanionTokenStore
  readonly port: number
  readonly nowMs?: number
  readonly homeDirectory?: string
  readonly stage?: typeof stageEditorCompanionBootstrap
}): EditorCompanionBootstrap {
  const checkpoint = input.tokens.checkpoint('editor')
  const nowMs = input.nowMs ?? Date.now()
  const token = input.tokens.rotate('editor', nowMs)
  try {
    return (input.stage ?? stageEditorCompanionBootstrap)({
      port: input.port,
      token,
      nowMs,
      ...(input.homeDirectory === undefined
        ? {}
        : { homeDirectory: input.homeDirectory }),
    })
  } catch (error) {
    input.tokens.restore('editor', checkpoint, token)
    throw error
  }
}
