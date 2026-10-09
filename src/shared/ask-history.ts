/** An intentionally bounded, deterministic interpretation, not a generative answer. */
export type HistoryQuestionIntent =
  | 'projects' | 'files' | 'applications' | 'saves' | 'checks' | 'overview'

export interface AskHistoryRequest {
  readonly query: string
  readonly limit?: number
}

export interface HistorySearchHit {
  readonly id: string
  readonly kind: 'workspace' | 'file' | 'application' | 'save' | 'verification'
  readonly title: string
  readonly episodeId: string
  readonly observedAtMs: number
  readonly workspaceTitle?: string
  readonly projectMemoryId?: string
  readonly resourceUri?: string
  readonly evidenceLevel: 'observation-backed' | 'episode-compacted'
  /** Metadata reports historical events only, not present completion. */
  readonly provenance: string
}

export interface AskHistoryResult {
  readonly status: 'matches' | 'no-evidence'
  readonly question: string
  readonly intent: HistoryQuestionIntent
  readonly searchedFromMs?: number
  readonly searchedUntilMs?: number
  readonly items: readonly HistorySearchHit[]
  readonly scannedEpisodes: number
  /** Hit a bounded scan cap; absence of evidence must not become absence of work. */
  readonly scanTruncated: boolean
  readonly notesAccess: 'not-searched'
  readonly caveat: string
}
