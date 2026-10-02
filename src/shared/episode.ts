import type { EpisodeId, ObservationId } from './ids.js'
import type { SurfaceKind } from './observation.js'
import type { ResourceIdentity } from './resource.js'

export type EpisodeState = 'open' | 'closed' | 'invalidated'
/**
 * Who produced the summary text (ADR 0004 §5). `deterministic` is computed
 * locally from stored observations; `local` came from a model on this machine;
 * `remote` from a model reached over the network, which requires a recorded
 * per-scope opt-in.
 */
export type EpisodeSummaryKind = 'deterministic' | 'local' | 'remote'

export type EpisodeBoundaryReason =
  | 'first-observation'
  | 'workspace-switch'
  | 'idle'
  | 'sleep'
  | 'pause'
  | 'collector-restart'
  | 'timeout'
  | 'manual-rebuild'

/**
 * A line of work: the episodes sharing a `threadKey`, with the evidence behind
 * the grouping (ADR 0004 §5).
 */
export interface WorkThread {
  readonly threadKey: string
  readonly episodeIds: readonly string[]
  readonly episodeCount: number
  readonly startedAtMs: number
  readonly endedAtMs: number
  readonly resources: readonly ResourceIdentity[]
  readonly summary: string
  readonly summaryObservationIds: readonly ObservationId[]
}

export interface EpisodeResourceSummary extends ResourceIdentity {
  readonly firstSeenAtMs: number
  readonly lastSeenAtMs: number
  readonly observationCount: number
}

export interface EpisodeSurfaceSummary {
  readonly bundleId: string
  readonly surfaceKind: SurfaceKind
  readonly firstSeenAtMs: number
  readonly lastSeenAtMs: number
  readonly observationCount: number
}

export interface EpisodeWorkspaceSummary {
  readonly id?: string
  readonly root?: string
  readonly title?: string
}

export interface EpisodeBoundary {
  readonly startReason: EpisodeBoundaryReason
  readonly endReason?: EpisodeBoundaryReason
}

export interface EpisodeSummary {
  readonly id: EpisodeId
  readonly startedAtMs: number
  readonly endedAtMs: number
  readonly boundary: EpisodeBoundary
  readonly workspace?: EpisodeWorkspaceSummary
  readonly threadKey?: string
  readonly summaryKind: EpisodeSummaryKind
  readonly summary: string
  /**
   * The observations the summary was derived from. A summary without citations
   * is invalid (ADR 0004 §5): a reader must be able to check it against stored
   * evidence, and deleting that evidence must be able to invalidate it.
   */
  readonly summaryObservationIds: readonly ObservationId[]
  readonly lastStrongResource?: ResourceIdentity
  readonly resources: readonly EpisodeResourceSummary[]
  readonly surfaces: readonly EpisodeSurfaceSummary[]
  readonly confidence: number
  readonly state: EpisodeState
}

export interface EpisodeDetail extends EpisodeSummary {
  readonly observationIds: readonly ObservationId[]
}
