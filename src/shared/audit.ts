/** The document format the audit export writes and the import reads back. */
export const HISTORY_EXPORT_SCHEMA = 'dsh-computer-history/v1'

/**
 * A projection of the tables that already exist, not a second schema: whatever
 * the store holds is what the export carries, so a round trip cannot drift from
 * the source of truth. Credentials (the companion pairing digest) and the
 * deletion log are not part of it.
 */
export interface HistoryExport {
  readonly schema: typeof HISTORY_EXPORT_SCHEMA
  readonly exportedAtMs: number
  readonly schemaVersion: number
  readonly tables: Record<string, readonly Record<string, unknown>[]>
}
