import type { MemoryEvidenceLevel, MemoryFactKind } from './memory.js'
import type { RelatedActivity } from './thread-intelligence.js'

/**
 * Optional depth for one CURRENT session-bound Continue. No ambient
 * lookup by workspace label, project name, or another session ID.
 */
export interface ContextualContinueFact {
  readonly kind: MemoryFactKind
  readonly observedAtMs?: number
  readonly text: string
  readonly sourceEpisodeIds: readonly string[]
  readonly evidenceLevel: MemoryEvidenceLevel
}

export type ContextualContinueLink = Pick<RelatedActivity,
  'episodeId' | 'anchorEpisodeId' | 'kind' | 'attribution'
  | 'observedAtMs' | 'appBundleIds' | 'sourceEvidence'
  | 'sharedResourceUri'>

export type ContextualContinueResult =
  | {
      readonly status: 'unavailable'
      readonly reason: 'no-session-binding' | 'source-not-retained'
        | 'no-trusted-project'
    }
  | {
      readonly status: 'ready'
      readonly boundEpisodeId: string
      readonly project: {
        readonly id: string
        readonly title: string
        readonly episodeCount: number
        readonly lastObservedAtMs: number
      }
      readonly facts: readonly ContextualContinueFact[]
      readonly relatedActivity: readonly ContextualContinueLink[]
      readonly scanTruncated: boolean
      readonly privacy: {
        readonly userConfirmedNotes: 'excluded'
        readonly unrelatedProjects: 'excluded'
        readonly askYourHistory: 'not-auto-run'
        readonly readMode: 'bound-session-on-demand'
      }
      readonly caveat: string
    }
