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

export interface RecordedApplicationIdentity {
  readonly bundleId: string
  readonly displayName?: string
}

export type RedactionReason =
  | 'built-in-protected-app'
  | 'policy-disallowed'
  | 'secure-path'
  | 'unreadable-resource'
  | 'protected-title'
  | 'protected-metadata'
  | 'browser-unpaired'
  | 'unlocatable-file-name'

/** One row the current policy would not have kept. */
export interface RedactionPreviewEntry {
  readonly observationId: number
  readonly label: string
  readonly bundleId: string
  readonly reason: RedactionReason
}

/**
 * "What would this policy not keep?" Computed by running the ingestion
 * predicates over stored rows, so the answer cannot drift from what ingestion
 * actually does.
 */
export interface RedactionPreview {
  readonly scopeKey: string
  readonly policyRevision: number
  readonly rulesInForce: {
    readonly protectedBundleIds: readonly string[]
    readonly protectedPatterns: readonly string[]
    readonly hasProtectRule: boolean
  }
  readonly checked: number
  readonly excluded: readonly RedactionPreviewEntry[]
}

export const RETENTION_BOUNDS = {
  observationRetentionHours: { min: 1, max: 720 },
  episodeRetentionDays: { min: 1, max: 365 },
} as const

/** The user's retention choice, as the panel shows and edits it. */
export interface RetentionSettings {
  readonly observationRetentionHours: number
  readonly episodeRetentionDays: number
  /** Zero means the built-in default is in force. */
  readonly updatedAtMs: number
}
