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

function hardenMode(target: string, mode: number): void {
  if (!existsSync(target)) return
  chmodSync(target, mode)
}

function assertModeAtMost(target: string, expected: number): void {
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

  return {
    db,
    dataDirectory,
    databasePath,
    close(): void {
      db.close()
      hardenDatabaseSidecars(databasePath)
    },
  }
}
