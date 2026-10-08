import type {
  EpisodeChangedResource,
  EpisodeSummary,
  EpisodeVerificationSummary,
  EpisodeSurfaceSummary,
  EpisodeWorkspaceSummary,
} from './episode.js'
import type { ResourceIdentity } from './resource.js'
import type { EpisodeId, ObservationId } from './ids.js'


/**
 * Whether an Episode is a safe default for an unqualified "Continue" action.
 *
 * Generic continuation is stricter than explicit resume. A passive window with
 * no workspace/resource is history, not a work target, and a terminal-only
 * tail must not displace the workspace/file the user can actually pick back up.
 * Explicit workspace/resource/surface queries may still resolve those Episodes.
 */
export function isGenericContinuationCandidate(
  episode: Pick<
    EpisodeSummary,
    | 'state'
    | 'summaryObservationIds'
    | 'workspace'
    | 'lastStrongResource'
    | 'resources'
    | 'surfaces'
  >,
): boolean {
  if (episode.state === 'invalidated') return false
  if (episode.summaryObservationIds.length === 0) return false

  const terminalOnly = episode.surfaces.length > 0
    && episode.surfaces.every(surface => surface.surfaceKind === 'terminal')
  if (terminalOnly) return false

  const workspace = episode.workspace
  const hasWorkspace = Boolean(
    workspace?.id?.trim()
    || workspace?.root?.trim()
    || workspace?.title?.trim(),
  )
  const hasResource = Boolean(
    episode.lastStrongResource?.canonicalUri.trim()
    || episode.resources.some(resource => resource.canonicalUri.trim()),
  )

  return hasWorkspace || hasResource
}

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

export interface DshCheckpoint {
  readonly sessionId: string
  readonly turn: number
  readonly checkpointAtMs: number
  readonly cwd?: string
  readonly workspace?: EpisodeWorkspaceSummary
  /** Repository HEAD at the DSH turn boundary; metadata only, no commit message or diff. */
  readonly gitHead?: string
}

export interface RecordDshCheckpointRequest extends DshCheckpoint {}

export interface ResumeGitFile {
  readonly path: string
  /** Git porcelain v2 XY status, or ?? for untracked. */
  readonly status: string
}

export interface ResumeGitState {
  /** When this current-worktree metadata probe completed. */
  readonly observedAtMs: number
  readonly branch?: string
  readonly head?: string
  readonly dirty: boolean
  readonly changedFiles: readonly ResumeGitFile[]
  readonly truncated: boolean
}

export interface ResumeUrlDetourBridge {
  /** One URL-only browser Episode sandwiched by the same explicit work thread. */
  readonly episodeId: EpisodeId
  readonly startedAtMs: number
  readonly lastActiveAtMs: number
  readonly referenceResources: readonly ResourceIdentity[]
  readonly evidenceObservationIds: readonly ObservationId[]
}

export interface ResumeThreadTail {
  /** Earlier Episodes in the same explicit thread, oldest to newest. */
  readonly episodeIds: readonly EpisodeId[]
  readonly startedAtMs: number
  readonly lastActiveAtMs: number
  readonly recentResources: readonly ResourceIdentity[]
  readonly referenceResources: readonly ResourceIdentity[]
  readonly changedResources: readonly EpisodeChangedResource[]
  readonly verifications: readonly EpisodeVerificationSummary[]
  readonly evidenceObservationIds: readonly ObservationId[]
}

export interface ResumeHandoffCandidate {
  readonly episodeId: EpisodeId
  readonly threadKey?: string
  readonly workspace?: EpisodeWorkspaceSummary
  readonly lastActiveAtMs: number
  readonly lastActiveResource?: ResourceIdentity
}

/**
 * Agent-facing continuation state projected from auditable Episodes.
 *
 * This is intentionally structured and intentionally does not carry the Episode
 * summary sentence. A handoff tells the Agent where work stopped and which
 * evidence to verify; it does not turn observed metadata into an asserted fact.
 */
export type ResumeHandoff =
  | {
      readonly status: 'hit'
      readonly episodeId: EpisodeId
      readonly threadKey?: string
      readonly workspace?: EpisodeWorkspaceSummary
      readonly startedAtMs: number
      readonly lastActiveAtMs: number
      readonly lastActiveResource?: ResourceIdentity
      readonly recentResources: readonly ResourceIdentity[]
      /** Browser/web resources observed during this work, separated from working files. */
      readonly referenceResources: readonly ResourceIdentity[]
      readonly changedResources: readonly EpisodeChangedResource[]
      readonly verifications: readonly EpisodeVerificationSummary[]
      readonly surfaces: readonly EpisodeSurfaceSummary[]
      readonly confidence: number
      readonly reasons: readonly ResumeReason[]
      readonly evidenceObservationIds: readonly [ObservationId, ...ObservationId[]]
      /** Current repository shape at handoff time; metadata only, never a diff. */
      readonly git?: ResumeGitState
      /** Latest metadata-only DSH turn boundary in this workspace before the external work began. */
      readonly checkpoint?: DshCheckpoint
      /**
       * Bounded earlier Episodes sharing this exact threadKey.
       * Explicit Continue may use this as lower-priority historical context;
       * automatic resume does not attach it.
       */
      readonly priorThreadTail?: ResumeThreadTail
      /**
       * Lower-priority browser reference evidence. Present only when one
       * unthreaded URL/browser Episode is the sole recorded detour between two
       * Episodes carrying this same explicit threadKey.
       */
      readonly urlDetourBridge?: ResumeUrlDetourBridge
    }
  | {
      readonly status: 'ambiguous'
      readonly candidates: readonly ResumeHandoffCandidate[]
      readonly reason: string
    }
  | {
      readonly status: 'none'
      readonly reason: string
    }

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


export interface ResumeOpenCapability {
  readonly available: boolean
  readonly reason?: 'platform-unverified' | 'opener-unavailable'
}

/**
 * A Continue request names stored evidence, never an arbitrary local path.
 * `resourceCanonicalUri`, when present, must exactly match a resource already
 * attached to that Episode; the Host revalidates this before opening anything.
 */
export interface ResumeOpenRequest {
  readonly episodeId: EpisodeId
  readonly resourceCanonicalUri?: string
}

export type ResumeOpenResult =
  | {
      readonly status: 'opened'
      readonly appBundleId?: string
      readonly kind: ResourceIdentity['kind']
    }
  | {
      readonly status: 'unsupported'
      readonly reason:
        | 'platform-unverified'
        | 'opener-unavailable'
        | 'no-openable-resource'
        | 'unsupported-resource'
        | 'resource-missing'
    }
