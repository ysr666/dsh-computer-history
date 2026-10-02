import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  latestSchemaVersion,
  openHistoryDatabase,
} from '../../src/host/store/index.js'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-db-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('history database', () => {
  it('creates and migrates a hardened SQLite database', () => {
    const root = tempRoot()
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1234,
    })

    expect(statSync(history.dataDirectory).mode & 0o777).toBe(0o700)
    expect(statSync(history.databasePath).mode & 0o777).toBe(0o600)
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${history.databasePath}${suffix}`
      if (existsSync(sidecar)) {
        expect(statSync(sidecar).mode & 0o777).toBe(0o600)
      }
    }

    const version = history.db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(latestSchemaVersion())

    const migration = history.db.prepare(`
      SELECT version, name, checksum, applied_at_ms
      FROM schema_migrations
    `).get() as {
      version: number
      name: string
      checksum: string
      applied_at_ms: number
    }

    expect(migration).toEqual({
      version: 1,
      name: 'initial',
      checksum: '2026-10-01-initial-v1',
      applied_at_ms: 1234,
    })

    expect(history.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    history.close()
  })

  it('is idempotent when reopening the same schema', () => {
    const root = tempRoot()
    const dataDirectory = path.join(root, 'history')
    openHistoryDatabase({ dataDirectory, nowMs: 100 }).close()
    const reopened = openHistoryDatabase({ dataDirectory, nowMs: 999 })
    // One row per migration, whatever the latest version is: the point of the
    // assertion is that reopening does not re-apply anything, not that the
    // schema has a particular number of migrations.
    expect(
      reopened.db.prepare('SELECT * FROM schema_migrations').all(),
    ).toHaveLength(latestSchemaVersion())
    reopened.close()
  })

  it('fails closed when a migration checksum no longer matches', () => {
    const root = tempRoot()
    const dataDirectory = path.join(root, 'history')
    const history = openHistoryDatabase({ dataDirectory, nowMs: 100 })
    history.db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('tampered')
    history.close()

    expect(() => openHistoryDatabase({ dataDirectory, nowMs: 200 }))
      .toThrow(/migration checksum mismatch/)
  })

  it('rejects a database schema newer than this build supports', () => {
    const root = tempRoot()
    const dataDirectory = path.join(root, 'history')
    const history = openHistoryDatabase({ dataDirectory, nowMs: 100 })
    history.db.exec('PRAGMA user_version = 999')
    history.close()

    expect(() => openHistoryDatabase({ dataDirectory, nowMs: 200 }))
      .toThrow(/newer than supported/)
  })
})
