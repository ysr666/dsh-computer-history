import type { EpisodeSummary } from './episode.js'

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
