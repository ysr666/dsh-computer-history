import {
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrations.js'

export interface OpenHistoryDatabaseOptions {
  readonly dataDirectory: string
  readonly filename?: string
  readonly nowMs?: number
}

export interface HistoryDatabase {
  readonly db: DatabaseSync
  readonly dataDirectory: string
  readonly databasePath: string
  close(): void
}

/**
 * Whether the POSIX mode bits this module hardens and asserts exist on a platform.
 *
 * They do not on Windows: `chmod` there only toggles the read-only attribute and `stat` reports a
 * synthetic `0o666`/`0o444`, so "no broader than 0600" would refuse to open the store at all. The
 * protection Windows has is the ACL on the data directory, which this check cannot read - ADR 0005
 * describes the macOS mechanism (FileVault plus a non-synced location) that the hardening belongs to.
 * The exemption is a recorded gap, not a check that silently passes.
 */
export function appliesPosixModes(platform: NodeJS.Platform): boolean {
  return platform !== 'win32'
}

function hardenMode(target: string, mode: number): void {
  if (!appliesPosixModes(process.platform)) return
  if (!existsSync(target)) return
  chmodSync(target, mode)
}

function assertModeAtMost(target: string, expected: number): void {
  if (!appliesPosixModes(process.platform)) return
  const actual = statSync(target).mode & 0o777
  if ((actual & ~expected) !== 0) {
    throw new Error(
      `unsafe permissions for ${target}: expected no broader than ${expected.toString(8)}, got ${actual.toString(8)}`,
    )
  }
}

export function hardenDatabaseSidecars(databasePath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${databasePath}${suffix}`
    hardenMode(target, 0o600)
    if (existsSync(target)) assertModeAtMost(target, 0o600)
  }
}

export function openHistoryDatabase(
  options: OpenHistoryDatabaseOptions,
): HistoryDatabase {
  const dataDirectory = path.resolve(options.dataDirectory)
  const databasePath = path.join(
    dataDirectory,
    options.filename ?? 'history.sqlite',
  )

  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  hardenMode(dataDirectory, 0o700)
  assertModeAtMost(dataDirectory, 0o700)

  const db = new DatabaseSync(databasePath)
  try {
    hardenMode(databasePath, 0o600)

    // Install the lock wait before WAL initialization/migration:
    // multiple DSH profiles may open the shared history database
    // concurrently on first boot.
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA secure_delete = ON')
    db.exec('PRAGMA synchronous = NORMAL')

    migrate(db, options.nowMs)
    hardenDatabaseSidecars(databasePath)
  } catch (error) {
    try {
      db.close()
    } catch {
      // Initialization failure is authoritative.
    }
    try {
      hardenDatabaseSidecars(databasePath)
    } catch {
      // Do not obscure the initialization failure.
    }
    throw error
  }

  return {
    db,
    dataDirectory,
    databasePath,
    close(): void {
      try {
        db.close()
      } finally {
        hardenDatabaseSidecars(databasePath)
      }
    },
  }
}
