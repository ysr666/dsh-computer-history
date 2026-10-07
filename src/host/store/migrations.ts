import type { DatabaseSync } from 'node:sqlite'
import { migration0001 } from './migrations/0001-initial.js'
import { migration0002 } from './migrations/0002-companion-pairing.js'
import { migration0003 } from './migrations/0003-semantic-citations.js'
import { migration0004 } from './migrations/0004-semantic-opt-ins.js'
import { migration0005 } from './migrations/0005-retention-settings.js'
import { migration0006 } from './migrations/0006-companion-workspace-source.js'
import { migration0007 } from './migrations/0007-remote-summary-sends.js'
import { migration0008 } from './migrations/0008-companion-pairing-kinds.js'
import { migration0009 } from './migrations/0009-activity-event.js'
import { migration0010 } from './migrations/0010-dsh-checkpoints.js'
import { migration0011 } from './migrations/0011-dsh-checkpoint-git-head.js'
import { migration0012 } from './migrations/0012-verification-events.js'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly checksum: string
  /**
   * Set by a migration that rebuilds a table other tables reference. SQLite's
   * documented rebuild procedure runs with foreign keys disabled, and the
   * pragma is a no-op inside a transaction, so the runner has to toggle it
   * around this migration's own transaction. Integrity is re-checked before
   * the transaction commits.
   */
  readonly rebuildsReferencedTable?: boolean
  up(db: DatabaseSync): void
}

const MIGRATIONS: readonly Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
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

/**
 * The migrations a database says it has applied, or `undefined` when there is no `schema_migrations` table yet -
 * a brand new store.
 */
function recordedMigrations(
  db: DatabaseSync,
): Array<{ version: number, checksum: string }> | undefined {
  try {
    return db.prepare(`
      SELECT version, checksum
      FROM schema_migrations
      ORDER BY version
    `).all() as Array<{ version: number, checksum: string }>
  } catch {
    return undefined
  }
}

export function migrate(
  db: DatabaseSync,
  nowMs = Date.now(),
): void {
  let initial = schemaVersion(db)
  if (initial === 0) {
    // A store can hold every table and still report version 0: `sqlite3 old.db .dump | sqlite3 new.db` writes
    // the schema and the rows and never `PRAGMA user_version`. Replaying migration 0001 into such a store fails
    // with "table schema_migrations already exists" on data that is perfectly intact, and the message says
    // nothing about the real cause. The recorded migrations know which version the store actually is, so adopt
    // it when the records match this build, and refuse by name when they do not.
    const recorded = recordedMigrations(db)
    if (recorded !== undefined && recorded.length > 0) {
      const expected = MIGRATIONS.slice(0, recorded.length)
      const matches = expected.length === recorded.length
        && expected.every((migration, index) =>
          recorded[index]?.version === migration.version
          && recorded[index]?.checksum === migration.checksum)
      if (!matches) {
        throw new Error(
          'this store records migrations that do not match this build: it was restored without its schema '
          + 'version, or written by a different version. Back it up and start a new store rather than '
          + 'migrating it blind.',
        )
      }
      const adopted = recorded[recorded.length - 1]?.version ?? 0
      db.exec(`PRAGMA user_version = ${adopted}`)
      initial = adopted
    }
  }
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

    const foreignKeysOff = migration.rebuildsReferencedTable === true
    if (foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF')
    try {
      db.exec('BEGIN IMMEDIATE')
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
      if (foreignKeysOff) {
        // A rebuild that lost a child row would leave the database quietly
        // inconsistent; refuse to commit instead.
        const violations = db.prepare('PRAGMA foreign_key_check').all()
        if (violations.length > 0) {
          throw new Error(
            `migration ${migration.version} left ${violations.length} foreign key violation(s)`,
          )
        }
      }
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
    } finally {
      if (foreignKeysOff) db.exec('PRAGMA foreign_keys = ON')
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
