import type { EpisodeSummary } from './episode.js'
import type { ResourceIdentity } from './resource.js'
import type { ObservationId } from './ids.js'

export interface ResumeRequest {
  readonly query: string
  readonly nowMs: number
  readonly currentWorkspaceId?: string
  readonly turn: number
  readonly source: 'automatic' | 'tool'
}

export type ResumeReason =
  | 'explicit-workspace'
  | 'exact-resource'
  | 'current-workspace'
  | 'surface-recency'
  | 'recent-episode'

export type ResumeResolution =
  | {
      readonly status: 'hit'
      readonly episode: EpisodeSummary
      readonly confidence: number
      readonly reasons: readonly ResumeReason[]
      /**
       * The resource a person would reopen to continue this work. Absent when
       * the episode never touched a resource.
       */
      readonly resource?: ResourceIdentity
      /**
       * The evidence behind the hint (ADR 0004 §5). Required and never empty:
       * a suggestion a reader cannot check is not allowed to exist, so the
       * resolver refuses to produce a hit from an episode with no citations.
       */
      readonly citations: readonly [ObservationId, ...ObservationId[]]
    }
  | {
      readonly status: 'ambiguous'
      readonly candidates: readonly EpisodeSummary[]
      readonly reason: string
    }
  | {
      readonly status: 'none'
      readonly reason: string
    }
