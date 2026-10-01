import type { DatabaseSync } from 'node:sqlite'
import { migration0001 } from './migrations/0001-initial.js'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly checksum: string
  up(db: DatabaseSync): void
}

const MIGRATIONS: readonly Migration[] = [migration0001]

export function migrate(db: DatabaseSync, nowMs = Date.now()): void {
  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  const latest = MIGRATIONS.at(-1)?.version ?? 0

  if (current > latest) {
    throw new Error(`database schema version ${current} is newer than supported version ${latest}`)
  }

  if (current > 0) {
    const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as Array<{ version: number; checksum: string }>
    for (const migration of MIGRATIONS.filter((item) => item.version <= current)) {
      const row = rows.find((item) => item.version === migration.version)
      if (!row || row.checksum !== migration.checksum) {
        throw new Error(`migration checksum mismatch at version ${migration.version}`)
      }
    }
  }

  for (const migration of MIGRATIONS.filter((item) => item.version > current)) {
    db.exec('BEGIN IMMEDIATE')
    try {
      migration.up(db)
      db.prepare(
        'INSERT INTO schema_migrations(version, name, checksum, applied_at_ms) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, migration.checksum, nowMs)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

export function latestSchemaVersion(): number {
  return MIGRATIONS.at(-1)?.version ?? 0
}
