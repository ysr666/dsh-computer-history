import type {
  EpisodeDetail,
  EpisodeSummary,
  WorkThread,
} from './episode.js'
import type { HistoryExport } from './audit.js'
import type { EpisodeId } from './ids.js'
import type {
  MinimisedSummaryPayload,
  SemanticOptIn,
  SemanticSummaryState,
} from './semantic.js'
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

export interface PairingState {
  readonly paired: boolean
  readonly createdAtMs?: number
  /** Whether the companion intake is listening, and on which loopback port. */
  readonly listening: boolean
  readonly port?: number
}

export interface PairingRotation extends PairingState {
  /** Returned once; the store keeps only its digest. */
  readonly token: string
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
  readonly reason?: string
  /**
   * The browser companion's intake state (ADR 0007). `listening: false` with a
   * reason means the port could not be bound; the panel shows it rather than
   * leaving pairing looking available.
   */
  readonly companion?: {
    readonly listening: boolean
    readonly port?: number
    readonly paired: boolean
    readonly reason?: string
  }
  readonly observationRetentionHours: number
  readonly episodeRetentionDays: number
  readonly autoResume: boolean
  readonly collector?: {
    readonly version: string
    readonly arch: string
  }
}

export interface ComputerHistoryServiceContract {
  /** Companion pairing state (ADR 0007). */
  pairing(): PairingState

  /** Rotate the pairing token; the token is returned once. */
  rotatePairing(): PairingRotation

  /** The audit export: everything this Host knows, as one document. */
  exportAll(): HistoryExport

  /** Read an export back. Throws HistoryImportError-shaped failures as messages. */
  importAll(document: unknown): { readonly imported: Record<string, number> }

  /** Who produces summaries, per scope (ADR 0004 §4). */
  semanticState(): SemanticSummaryState

  /** The exact payload a provider would see for a scope (ADR 0004 §4). */
  semanticPreview(request: {
    readonly scopeKey: string
  }): MinimisedSummaryPayload | undefined

  grantSemanticOptIn(request: {
    readonly scopeKey: string
    readonly providerKind: 'local' | 'remote'
    readonly model?: string
  }): SemanticOptIn

  /** "Turn off and purge": revoke the permission and delete model summaries. */
  revokeSemanticOptIn(request: {
    readonly scopeKey: string
  }): { readonly revoked: boolean; readonly purged: number }

  /** Work threads over stored episodes (ADR 0004 §5: each carries citations). */
  threads(request?: { readonly limit?: number }): Promise<readonly WorkThread[]>

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
