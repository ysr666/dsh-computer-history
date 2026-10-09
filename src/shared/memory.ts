/**
 * Read-only, ephemeral work memory projection. No source contents are read,
 * and no facts outlive the stored Episodes from which they are computed.
 */
export type MemoryEvidenceLevel = 'observation-backed' | 'episode-compacted'

export type MemoryFactKind =
  | 'workspace'
  | 'resource'
  | 'activity'
  | 'save'
  | 'verification'

export interface MemoryFact {
  readonly id: string
  readonly kind: MemoryFactKind
  readonly text: string
  readonly evidenceLevel: MemoryEvidenceLevel
  readonly sourceEpisodeIds: readonly string[]
  readonly observedAtMs?: number
}

export interface ProjectMemory {
  /** Deterministic opaque digest of a validated thread identity, not a path. */
  readonly id: string
  readonly title: string
  readonly lastActiveAtMs: number
  readonly episodeCount: number
  readonly recentEpisodeIds: readonly string[]
  readonly facts: readonly MemoryFact[]
  /** "active" means observed within seven days, not that a task is unfinished. */
  readonly status: 'active' | 'stale'
}

export interface ListProjectMemoriesRequest {
  readonly limit?: number
  /** Optional literal case-insensitive match over names and observed facts. */
  readonly query?: string
}
