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
  | 'app-switch'
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
  /** Reader-facing Activity projection count across this line of work. */
  readonly activityCount: number
  /**
   * Approximate active time used by the timeline: merged Activities use their
   * wall-clock span while unmerged Activities use observed duration.
   */
  readonly approxActiveDurationMs: number
  readonly startedAtMs: number
  readonly endedAtMs: number
  /**
   * The workspace the thread happened in, carried so a view can name it in the
   * reader's language instead of parsing it back out of `summary`.
   */
  readonly workspaceTitle?: string
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
