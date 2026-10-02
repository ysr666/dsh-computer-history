import {
  HISTORY_EXPORT_SCHEMA,
  type HistoryExport,
} from '../../shared/index.js'
import type { DatabaseSync } from 'node:sqlite'


/**
 * Tables that make up "what this Host knows", in an order that satisfies every
 * foreign key on insert.
 *
 * Two tables are deliberately absent:
 * `companion_pairing` holds a credential (the pairing token digest), not
 * history, and `schema_migrations` describes the database rather than the user.
 * `deletion_log` is absent for the same reason as the pairing table: it records
 * *that* something was deleted, and exporting it would tell a reader what used
 * to exist here.
 */
export const EXPORTED_TABLES = [
  'resources',
  'policy_state',
  'policy_rules',
  'semantic_opt_ins',
  'observations',
  'episodes',
  'episode_observations',
  'episode_resources',
  'episode_surfaces',
  'episode_summary_citations',
] as const

export type ExportedTable = typeof EXPORTED_TABLES[number]

export { HISTORY_EXPORT_SCHEMA }
export type { HistoryExport }


export class HistoryImportError extends Error {}

function schemaVersion(db: DatabaseSync): number {
  return Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
}

/**
 * A projection of the tables that already exist, not a second schema: whatever
 * the store holds is what the export carries, so a round trip cannot drift from
 * the source of truth.
 */
export function exportHistory(
  db: DatabaseSync,
  nowMs = Date.now(),
): HistoryExport {
  const tables: Record<string, readonly Record<string, unknown>[]> = {}
  for (const table of EXPORTED_TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all() as
      Record<string, unknown>[]
  }
  return {
    schema: HISTORY_EXPORT_SCHEMA,
    exportedAtMs: nowMs,
    schemaVersion: schemaVersion(db),
    tables,
  }
}

interface ColumnInfo {
  readonly name: string
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[]
  ).map(column => column.name)
}

/**
 * Read a document back, refusing anything this Host cannot store verbatim: an
 * unknown schema, an unknown table, an unknown column, or a value that is not a
 * primitive. Validation is a whitelist read from the live database, so an
 * export from a future version fails loudly instead of half-importing.
 */
export function importHistory(
  db: DatabaseSync,
  document: unknown,
): { readonly imported: Record<string, number> } {
  if (typeof document !== 'object' || document === null) {
    throw new HistoryImportError('the document must be an object')
  }
  const candidate = document as Partial<HistoryExport>
  if (candidate.schema !== HISTORY_EXPORT_SCHEMA) {
    throw new HistoryImportError(
      `unsupported schema: ${String(candidate.schema)}`,
    )
  }
  if (typeof candidate.tables !== 'object' || candidate.tables === null) {
    throw new HistoryImportError('the document has no tables')
  }

  const imported: Record<string, number> = {}
  // Rows are grouped by the statement that inserts them, and the map's order is
  // the table order above, which is the order the foreign keys need.
  const byStatement = new Map<string, unknown[][]>()

  for (const table of EXPORTED_TABLES) {
    const rows = (candidate.tables as Record<string, unknown>)[table]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) {
      throw new HistoryImportError(`${table} must be an array`)
    }
    const known = new Set(columnsOf(db, table))
    let count = 0
    for (const raw of rows) {
      if (typeof raw !== 'object' || raw === null) {
        throw new HistoryImportError(`${table} contains a non-object row`)
      }
      const row = raw as Record<string, unknown>
      const names = Object.keys(row)
      if (names.length === 0) continue
      for (const name of names) {
        if (!known.has(name)) {
          throw new HistoryImportError(`${table} has an unknown column: ${name}`)
        }
        const value = row[name]
        if (
          value !== null
          && typeof value !== 'string'
          && typeof value !== 'number'
        ) {
          throw new HistoryImportError(
            `${table}.${name} is not a primitive value`,
          )
        }
      }
      const sql = `INSERT OR REPLACE INTO ${table} (${names.join(', ')}) `
        + `VALUES (${names.map(() => '?').join(', ')})`
      const bucket = byStatement.get(sql) ?? []
      bucket.push(names.map(name => row[name]))
      byStatement.set(sql, bucket)
      count += 1
    }
    imported[table] = count
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const [sql, rows] of byStatement) {
      const prepare = db.prepare(sql)
      for (const row of rows) prepare.run(...row as never[])
    }
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }

  return { imported }
}
