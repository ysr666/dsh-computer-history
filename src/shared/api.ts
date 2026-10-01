import type { EpisodeDetail, EpisodeSummary } from './episode.js'
import type { EpisodeId } from './ids.js'
import type { PolicyRule, PolicySnapshot } from './policy.js'
import type { ResumeRequest, ResumeResolution } from './resume.js'

export interface RecentEpisodesRequest {
  readonly sinceMs?: number
  readonly workspaceId?: string
  readonly limit?: number
}

export interface SearchEpisodesRequest {
  readonly query: string
  readonly sinceMs?: number
  readonly untilMs?: number
  readonly workspaceId?: string
  readonly bundleId?: string
  readonly limit?: number
}

export type DeleteHistoryScope =
  | {
      readonly kind: 'time-range'
      readonly startMs: number
      readonly endMs: number
    }
  | {
      readonly kind: 'episode'
      readonly episodeId: EpisodeId
    }
  | {
      readonly kind: 'app'
      readonly bundleId: string
    }
  | {
      readonly kind: 'all'
    }

export interface DeleteHistoryRequest {
  readonly scope: DeleteHistoryScope
}

export interface DeleteHistoryResult {
  readonly observationsDeleted: number
  readonly episodesDeleted: number
  readonly episodesRebuilt: number
}

export interface PolicyUpdate {
  readonly mode: PolicySnapshot['mode']
  readonly rules: readonly PolicyRule[]
}

export interface ComputerHistoryState {
  readonly enabled: boolean
  readonly capture:
    | 'stopped'
    | 'running'
    | 'paused'
    | 'permission-required'
    | 'degraded'
  readonly accessibilityTrusted: boolean
  readonly observationRetentionHours: number
  readonly episodeRetentionDays: number
  readonly autoResume: boolean
  readonly collector?: {
    readonly version: string
    readonly arch: string
  }
}

export interface ComputerHistoryServiceContract {
  recent(
    request?: RecentEpisodesRequest,
    signal?: AbortSignal,
  ): Promise<readonly EpisodeSummary[]>

  search(
    request: SearchEpisodesRequest,
    signal?: AbortSignal,
  ): Promise<readonly EpisodeSummary[]>

  getEpisode(
    id: EpisodeId,
    signal?: AbortSignal,
  ): Promise<EpisodeDetail | undefined>

  resolveResume(
    request: ResumeRequest,
    signal?: AbortSignal,
  ): Promise<ResumeResolution>

  delete(
    request: DeleteHistoryRequest,
    signal?: AbortSignal,
  ): Promise<DeleteHistoryResult>

  pause(): Promise<void>
  resume(): Promise<void>
  getState(): ComputerHistoryState
  listPolicyRules(): readonly PolicyRule[]
  getPolicy(): PolicySnapshot
  replacePolicy(update: PolicyUpdate): Promise<PolicySnapshot>
}
