import {
  HISTORY_EXPORT_SCHEMA,
  type HistoryExport,
} from '../../shared/index.js'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Tables that make up "what this Host knows".
 *
 * The export is an audit document, so it includes current policy and semantic
 * opt-in state. Import is deliberately narrower: a history backup must not be
 * able to change this device's capture permissions or remote-summary consent.
 *
 * Three tables are deliberately absent:
 * `companion_pairing` holds credentials, `schema_migrations` describes the
 * database rather than the user, and `deletion_log` would reveal what used to
 * exist after the user asked to forget it.
 */
export const EXPORTED_TABLES = [
  'resources',
  'policy_state',
  'policy_rules',
  'semantic_opt_ins',
  'remote_summary_sends',
  'dsh_checkpoints',
  'observations',
  'episodes',
  'continuation_sessions',
  'episode_observations',
  'episode_resources',
  'episode_surfaces',
  'episode_summary_citations',
  // Confirmed memories must be visible in the user's audit/export. Importing
  // them is deliberately NOT automatic: restoring indefinite-retention notes
  // requires a separate explicit confirmation flow, unlike expired Episodes.
  'memory_projects',
  'memory_user_notes',
  'memory_note_apps',
] as const

const IMPORTED_HISTORY_TABLES = new Set<ExportedTable>([
  'resources',
  'dsh_checkpoints',
  'observations',
  'episodes',
  'continuation_sessions',
  'episode_observations',
  'episode_resources',
  'episode_surfaces',
  'episode_summary_citations',
])

export type ExportedTable = typeof EXPORTED_TABLES[number]

export { HISTORY_EXPORT_SCHEMA }
export type { HistoryExport }

export class HistoryImportError extends Error {}

type Primitive = string | number | null
type ImportRow = Record<string, Primitive>

const OBSERVATION_V1_COLUMNS = [
  'id',
  'collector_session',
  'collector_seq',
  'observed_at_ms',
  'pid',
  'bundle_id',
  'app_name',
  'surface_kind',
  'window_title',
  'element_role',
  'element_subrole',
  'element_identifier',
  'element_title',
  'resource_id',
  'workspace_id',
  'workspace_root',
  'workspace_title',
  'workspace_source',
  'workspace_confidence',
  'idle_seconds',
  'privacy_secure',
  'privacy_protected',
  'privacy_reason',
  'source_provider',
  'source_adapter',
  'policy_revision',
  'expires_at_ms',
] as const

function schemaVersion(db: DatabaseSync): number {
  return Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
}

/**
 * A projection of the tables that already exist, not a second schema: whatever
 * the store holds is what the export carries.
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

function validateDocument(
  db: DatabaseSync,
  document: unknown,
): Map<ExportedTable, ImportRow[]> {
  if (typeof document !== 'object' || document === null) {
    throw new HistoryImportError('the document must be an object')
  }
  const candidate = document as Partial<HistoryExport>
  if (candidate.schema !== HISTORY_EXPORT_SCHEMA) {
    throw new HistoryImportError(
      `unsupported schema: ${String(candidate.schema)}`,
    )
  }
  const documentVersion = candidate.schemaVersion
  const currentVersion = schemaVersion(db)
  if (
    typeof documentVersion !== 'number'
    || !Number.isSafeInteger(documentVersion)
    || documentVersion < 1
    || documentVersion > currentVersion
  ) {
    throw new HistoryImportError(
      `unsupported schema version: ${String(documentVersion)}`,
    )
  }
  if (typeof candidate.tables !== 'object' || candidate.tables === null) {
    throw new HistoryImportError('the document has no tables')
  }

  const tableObject = candidate.tables as Record<string, unknown>
  const knownTables = new Set<string>(EXPORTED_TABLES)
  for (const name of Object.keys(tableObject)) {
    if (!knownTables.has(name)) {
      throw new HistoryImportError(`unknown table: ${name}`)
    }
  }

  const validated = new Map<ExportedTable, ImportRow[]>()
  for (const table of EXPORTED_TABLES) {
    const rawRows = tableObject[table]
    if (rawRows === undefined) continue
    if (!Array.isArray(rawRows)) {
      throw new HistoryImportError(`${table} must be an array`)
    }

    const knownColumns = new Set(columnsOf(db, table))
    const rows: ImportRow[] = []
    for (const raw of rawRows) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new HistoryImportError(`${table} contains a non-object row`)
      }
      const row = raw as Record<string, unknown>
      for (const name of Object.keys(row)) {
        if (!knownColumns.has(name)) {
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
      if (table === 'observations') {
        for (const name of OBSERVATION_V1_COLUMNS) {
          if (!Object.prototype.hasOwnProperty.call(row, name)) {
            throw new HistoryImportError(
              `observations.${name} is required by the v1 export schema`,
            )
          }
        }
      }
      rows.push(row as ImportRow)
    }
    validated.set(table, rows)
  }
  return validated
}

function requiredString(
  row: ImportRow,
  table: ExportedTable,
  name: string,
): string {
  const value = row[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new HistoryImportError(`${table}.${name} must be a non-empty string`)
  }
  return value
}

function requiredInteger(
  row: ImportRow,
  table: ExportedTable,
  name: string,
): number {
  const value = row[name]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HistoryImportError(`${table}.${name} must be a safe integer`)
  }
  return value
}

function optionalMappedId(
  row: ImportRow,
  table: ExportedTable,
  name: string,
  ids: ReadonlyMap<number, number>,
): number | null {
  const value = row[name]
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HistoryImportError(`${table}.${name} must be an integer or null`)
  }
  const mapped = ids.get(value)
  if (mapped === undefined) {
    throw new HistoryImportError(
      `${table}.${name} references missing imported id ${value}`,
    )
  }
  return mapped
}

function mappedId(
  row: ImportRow,
  table: ExportedTable,
  name: string,
  ids: ReadonlyMap<number, number>,
): number {
  const value = optionalMappedId(row, table, name, ids)
  if (value === null) {
    throw new HistoryImportError(`${table}.${name} is required`)
  }
  return value
}

function rememberId(
  map: Map<number, number>,
  sourceId: number,
  destinationId: number,
  table: ExportedTable,
): void {
  if (map.has(sourceId)) {
    throw new HistoryImportError(`${table} contains duplicate source id ${sourceId}`)
  }
  map.set(sourceId, destinationId)
}

function normaliseSqlValue(value: unknown): Primitive | undefined {
  if (typeof value === 'bigint') return Number(value)
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
  ) return value
  return undefined
}

function assertSameObservation(
  existing: Record<string, unknown>,
  row: ImportRow,
  mappedResourceId: number | null,
): void {
  for (const name of Object.keys(row)) {
    if (name === 'id') continue
    const expected = name === 'resource_id' ? mappedResourceId : row[name]
    const actual = normaliseSqlValue(existing[name])
    if (!Object.is(actual, expected)) {
      const session = String(row.collector_session ?? '')
      const seq = String(row.collector_seq ?? '')
      throw new HistoryImportError(
        `conflicting observation identity: ${session}:${seq}`,
      )
    }
  }
}

function insertRow(
  db: DatabaseSync,
  table: ExportedTable,
  row: ImportRow,
  options: {
    readonly omit?: ReadonlySet<string>
    readonly overrides?: ReadonlyMap<string, Primitive>
    readonly orIgnore?: boolean
  } = {},
): { readonly changes: number, readonly lastInsertRowid: number } {
  const omit = options.omit ?? new Set<string>()
  const names = Object.keys(row).filter(name => !omit.has(name))
  if (names.length === 0) {
    throw new HistoryImportError(`${table} contains an empty row`)
  }
  const values = names.map(name =>
    options.overrides?.has(name)
      ? options.overrides.get(name) ?? null
      : row[name] ?? null,
  )
  const result = db.prepare(
    `INSERT ${options.orIgnore ? 'OR IGNORE ' : ''}INTO ${table} (${names.join(', ')}) `
      + `VALUES (${names.map(() => '?').join(', ')})`,
  ).run(...values as never[])
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  }
}

/**
 * Merge a history export without ever reusing another database's numeric
 * primary keys.
 *
 * Resource and observation ids are database-local, so they are remapped through
 * stable identities before any foreign-key row is inserted. Existing episodes
 * win on a stable episode-id collision: importing a backup must never replace
 * local summary/provenance and trigger ON DELETE cascades.
 *
 * Policy state/rules and semantic opt-ins remain present in the audit document
 * but are not imported. They are permissions of this device, not historical
 * evidence; importing a JSON backup must not enable capture or remote sending.
 */
export function importHistory(
  db: DatabaseSync,
  document: unknown,
): { readonly imported: Record<string, number> } {
  const rows = validateDocument(db, document)
  const imported: Record<string, number> = {}
  for (const table of EXPORTED_TABLES) {
    if (rows.has(table)) imported[table] = 0
  }

  const resourceIds = new Map<number, number>()
  const observationIds = new Map<number, number>()
  const newEpisodes = new Set<string>()

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows.get('dsh_checkpoints') ?? []) {
      const inserted = insertRow(db, 'dsh_checkpoints', row, {
        omit: new Set(['id']),
        orIgnore: true,
      })
      imported.dsh_checkpoints =
        (imported.dsh_checkpoints ?? 0) + inserted.changes
    }

    for (const row of rows.get('resources') ?? []) {
      const sourceId = requiredInteger(row, 'resources', 'id')
      const kind = requiredString(row, 'resources', 'kind')
      const uri = requiredString(row, 'resources', 'canonical_uri')
      const existing = db.prepare(
        'SELECT id FROM resources WHERE kind = ? AND canonical_uri = ?',
      ).get(kind, uri) as { id?: number | bigint } | undefined

      if (existing?.id !== undefined) {
        const id = Number(existing.id)
        rememberId(resourceIds, sourceId, id, 'resources')
        const firstSeen = row.first_seen_at_ms
        const lastSeen = row.last_seen_at_ms
        if (typeof firstSeen === 'number' && typeof lastSeen === 'number') {
          db.prepare(`
            UPDATE resources
            SET first_seen_at_ms = MIN(first_seen_at_ms, ?),
                last_seen_at_ms = MAX(last_seen_at_ms, ?),
                display_label = COALESCE(display_label, ?)
            WHERE id = ?
          `).run(
            firstSeen,
            lastSeen,
            typeof row.display_label === 'string' ? row.display_label : null,
            id,
          )
        }
        continue
      }

      const inserted = insertRow(db, 'resources', row, {
        omit: new Set(['id']),
      })
      rememberId(resourceIds, sourceId, inserted.lastInsertRowid, 'resources')
      imported.resources = (imported.resources ?? 0) + inserted.changes
    }

    for (const row of rows.get('observations') ?? []) {
      const sourceId = requiredInteger(row, 'observations', 'id')
      const session = requiredString(row, 'observations', 'collector_session')
      const seq = requiredInteger(row, 'observations', 'collector_seq')
      const mappedResourceId = optionalMappedId(
        row,
        'observations',
        'resource_id',
        resourceIds,
      )
      const existing = db.prepare(
        'SELECT * FROM observations WHERE collector_session = ? AND collector_seq = ?',
      ).get(session, seq) as Record<string, unknown> | undefined

      if (existing) {
        assertSameObservation(existing, row, mappedResourceId)
        rememberId(
          observationIds,
          sourceId,
          Number(existing.id),
          'observations',
        )
        continue
      }

      const inserted = insertRow(db, 'observations', row, {
        omit: new Set(['id']),
        overrides: new Map([['resource_id', mappedResourceId]]),
      })
      rememberId(
        observationIds,
        sourceId,
        inserted.lastInsertRowid,
        'observations',
      )
      imported.observations = (imported.observations ?? 0) + inserted.changes
    }

    for (const row of rows.get('episodes') ?? []) {
      const id = requiredString(row, 'episodes', 'id')
      const existing = db.prepare(
        'SELECT 1 AS present FROM episodes WHERE id = ?',
      ).get(id)
      if (existing) continue

      const mappedStrongResourceId = optionalMappedId(
        row,
        'episodes',
        'last_strong_resource_id',
        resourceIds,
      )
      const inserted = insertRow(db, 'episodes', row, {
        overrides: new Map([
          ['last_strong_resource_id', mappedStrongResourceId],
        ]),
      })
      if (inserted.changes > 0) {
        newEpisodes.add(id)
        imported.episodes = (imported.episodes ?? 0) + 1
      }
    }

    for (const row of rows.get('continuation_sessions') ?? []) {
      const episodeId = requiredString(
        row,
        'continuation_sessions',
        'episode_id',
      )
      const episodeExists = db.prepare(
        'SELECT 1 AS present FROM episodes WHERE id = ?',
      ).get(episodeId)
      if (!episodeExists) {
        throw new HistoryImportError(
          `continuation_sessions.episode_id references missing episode ${episodeId}`,
        )
      }
      const inserted = insertRow(db, 'continuation_sessions', row, {
        orIgnore: true,
      })
      imported.continuation_sessions =
        (imported.continuation_sessions ?? 0) + inserted.changes
    }

    for (const row of rows.get('episode_observations') ?? []) {
      const episodeId = requiredString(row, 'episode_observations', 'episode_id')
      if (!newEpisodes.has(episodeId)) continue
      const observationId = mappedId(
        row,
        'episode_observations',
        'observation_id',
        observationIds,
      )
      const inserted = insertRow(db, 'episode_observations', row, {
        overrides: new Map([['observation_id', observationId]]),
        orIgnore: true,
      })
      imported.episode_observations =
        (imported.episode_observations ?? 0) + inserted.changes
    }

    for (const row of rows.get('episode_resources') ?? []) {
      const episodeId = requiredString(row, 'episode_resources', 'episode_id')
      if (!newEpisodes.has(episodeId)) continue
      const resourceId = mappedId(
        row,
        'episode_resources',
        'resource_id',
        resourceIds,
      )
      const inserted = insertRow(db, 'episode_resources', row, {
        overrides: new Map([['resource_id', resourceId]]),
        orIgnore: true,
      })
      imported.episode_resources =
        (imported.episode_resources ?? 0) + inserted.changes
    }

    for (const row of rows.get('episode_surfaces') ?? []) {
      const episodeId = requiredString(row, 'episode_surfaces', 'episode_id')
      if (!newEpisodes.has(episodeId)) continue
      const inserted = insertRow(db, 'episode_surfaces', row, {
        orIgnore: true,
      })
      imported.episode_surfaces =
        (imported.episode_surfaces ?? 0) + inserted.changes
    }

    for (const row of rows.get('episode_summary_citations') ?? []) {
      const episodeId = requiredString(
        row,
        'episode_summary_citations',
        'episode_id',
      )
      if (!newEpisodes.has(episodeId)) continue
      const observationId = mappedId(
        row,
        'episode_summary_citations',
        'observation_id',
        observationIds,
      )
      const inserted = insertRow(db, 'episode_summary_citations', row, {
        overrides: new Map([['observation_id', observationId]]),
        orIgnore: true,
      })
      imported.episode_summary_citations =
        (imported.episode_summary_citations ?? 0) + inserted.changes
    }

    // Explicitly document the trust boundary in the result too: these rows may
    // be present in an audit export, but history import never applies them.
    for (const table of rows.keys()) {
      if (!IMPORTED_HISTORY_TABLES.has(table)) imported[table] = 0
    }

    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    if (error instanceof HistoryImportError) throw error
    throw new HistoryImportError(
      `the document contains a row this Host cannot store: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return { imported }
}
