import type { DatabaseSync } from 'node:sqlite'
import { migration0001 } from './migrations/0001-initial.js'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly checksum: string
  up(db: DatabaseSync): void
}

const MIGRATIONS: readonly Migration[] = [
  migration0001,
]

function schemaVersion(db: DatabaseSync): number {
  return Number(
    db.prepare('PRAGMA user_version')
      .get()?.user_version ?? 0,
  )
}

function verifyApplied(
  db: DatabaseSync,
  version: number,
): void {
  if (version === 0) return

  const rows = db.prepare(`
    SELECT version, checksum
    FROM schema_migrations
    ORDER BY version
  `).all() as Array<{
    version: number
    checksum: string
  }>

  for (
    const migration of MIGRATIONS.filter(
      item => item.version <= version,
    )
  ) {
    const row = rows.find(
      item => item.version === migration.version,
    )
    if (
      !row
      || row.checksum !== migration.checksum
    ) {
      throw new Error(
        `migration checksum mismatch at version ${migration.version}`,
      )
    }
  }
}

export function migrate(
  db: DatabaseSync,
  nowMs = Date.now(),
): void {
  const initial = schemaVersion(db)
  const latest =
    MIGRATIONS.at(-1)?.version ?? 0

  if (initial > latest) {
    throw new Error(
      `database schema version ${initial} is newer than supported version ${latest}`,
    )
  }
  verifyApplied(db, initial)

  for (const migration of MIGRATIONS) {
    if (migration.version <= initial) continue

    db.exec('BEGIN IMMEDIATE')
    try {
      // Another Host may have migrated this shared
      // DSH_HOME database while this connection waited
      // for the writer lock. Re-read under BEGIN IMMEDIATE
      // before applying any DDL.
      const live = schemaVersion(db)
      if (live >= migration.version) {
        db.exec('COMMIT')
        continue
      }
      if (live !== migration.version - 1) {
        throw new Error(
          `unexpected schema version ${live} before migration ${migration.version}`,
        )
      }

      migration.up(db)
      db.prepare(`
        INSERT INTO schema_migrations(
          version,
          name,
          checksum,
          applied_at_ms
        ) VALUES (?, ?, ?, ?)
      `).run(
        migration.version,
        migration.name,
        migration.checksum,
        nowMs,
      )
      db.exec(
        `PRAGMA user_version = ${migration.version}`,
      )
      db.exec('COMMIT')
    } catch (error) {
      if (db.isTransaction) {
        db.exec('ROLLBACK')
      }
      throw error
    }
  }

  const final = schemaVersion(db)
  if (final > latest) {
    throw new Error(
      `database schema version ${final} is newer than supported version ${latest}`,
    )
  }
  verifyApplied(db, final)
}

export function latestSchemaVersion(): number {
  return MIGRATIONS.at(-1)?.version ?? 0
}
