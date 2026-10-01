import type { EpisodeId, ObservationId } from './ids.js'
import type { SurfaceKind } from './observation.js'
import type { ResourceIdentity } from './resource.js'

export type EpisodeState = 'open' | 'closed' | 'invalidated'
export type EpisodeSummaryKind = 'deterministic' | 'model'

export type EpisodeBoundaryReason =
  | 'first-observation'
  | 'workspace-switch'
  | 'idle'
  | 'sleep'
  | 'pause'
  | 'collector-restart'
  | 'timeout'
  | 'manual-rebuild'

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
  readonly lastStrongResource?: ResourceIdentity
  readonly resources: readonly EpisodeResourceSummary[]
  readonly surfaces: readonly EpisodeSurfaceSummary[]
  readonly confidence: number
  readonly state: EpisodeState
}

export interface EpisodeDetail extends EpisodeSummary {
  readonly observationIds: readonly ObservationId[]
}
