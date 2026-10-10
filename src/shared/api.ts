import type { AskHistoryRequest, AskHistoryResult } from './ask-history.js'
import type { ThreadActivityLinks } from './thread-intelligence.js'
import type { ContextualContinueResult } from './contextual-continue.js'
import type { SkillCandidateReport } from './skill-candidates.js'
import type {
  ConfirmUserMemoryNoteRequest, ListProjectMemoriesRequest,
  ProjectMemory, UserMemoryNote,
} from './memory.js'
import type {
  EpisodeDetail,
  EpisodeSummary,
  WorkThread,
} from './episode.js'
import type {
  HistoryExport,
  RedactionPreview,
  RetentionSettings,
} from './audit.js'
import type { TimelineDay, WorkThreadDetail } from './audit-view.js'
import type { BindContinuationSessionRequest } from './continuation-reference.js'
import type { EpisodeId } from './ids.js'
import type {
  MinimisedSummaryPayload,
  SemanticOptIn,
  SemanticSummaryState,
} from './semantic.js'
import type { PolicyRule, PolicySnapshot } from './policy.js'
import type { SurfaceKind } from './observation.js'
import type {
  DshCheckpoint,
  RecordDshCheckpointRequest,
  ResumeRequest,
  ResumeResolution,
} from './resume.js'

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

export type CompanionKind = 'browser' | 'editor'

export interface PairingState {
  readonly paired: boolean
  readonly createdAtMs?: number
  /** Whether the companion intake is listening, and on which loopback port. */
  readonly listening: boolean
  readonly port?: number
}

/** Files shipped with the plugin that let a user install the browser companion. */
export interface BrowserCompanionSetup {
  readonly chromium: {
    readonly available: boolean
    readonly extensionPath?: string
  }
}

export interface SupportedApplication {
  readonly bundleId: string
  readonly name: string
  readonly surfaceKind: SurfaceKind
}

export interface SupportedApplicationInventory {
  readonly available: boolean
  readonly applications: readonly SupportedApplication[]
  readonly reason?: 'platform-unverified' | 'inventory-unavailable'
}

export interface AccessibilitySettingsCapability {
  readonly available: boolean
  readonly reason?: 'platform-unverified' | 'opener-unavailable'
}

export interface AccessibilitySettingsOpenResult {
  readonly status: 'opened' | 'unsupported'
  readonly reason?: 'platform-unverified' | 'opener-unavailable' | 'open-failed'
}

export type EditorCompanionInstallReason =
  | 'platform-unverified'
  | 'code-cli-unavailable'
  | 'package-missing'
  | 'install-failed'
  | 'pairing-unavailable'
  | 'bootstrap-failed'

export interface EditorCompanionInstallCapability {
  readonly available: boolean
  readonly installed: boolean
  readonly installedVersion?: string
  readonly bundledVersion?: string
  readonly updateAvailable?: boolean
  readonly reason?: EditorCompanionInstallReason
}

export interface EditorCompanionInstallResult {
  readonly status: 'installed' | 'already-installed' | 'failed' | 'unsupported'
  /** A short-lived editor bootstrap credential was staged successfully. */
  readonly configured?: boolean
  readonly reason?: EditorCompanionInstallReason
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
  /**
   * How many observations were refused, by reason. The product says "nothing is
   * allowed yet"; this is the same fact with the evidence attached.
   */
  readonly refusedByReason?: Record<string, number>

  /**
   * The first-run preset, expanded to bundle ids, so the panel can offer it without
   * carrying its own copy of the adapter table. Absent when the preset file is not
   * shipped - the panel then behaves as it did before.
   */
  /**
   * What the running plugin is: its declared version, where it was loaded from, and when its built
   * entry was written. The interface uses it to say "the installed copy is the old code", which is a
   * failure that otherwise looks exactly like a broken feature.
   */
  readonly release?: {
    readonly version: string
    readonly loadedFrom: string
    readonly builtAtMs?: number
    readonly stale?: {
      readonly profile: string
      readonly artifact: string
      readonly artifactAtMs: number
      readonly updateCommand: string
    } | undefined
  } | undefined

  readonly firstRunPreset?: {
    readonly bundles: readonly string[]
    readonly title: Record<string, string>
    readonly description: Record<string, string>
  } | undefined
  readonly reason?: string
  /**
   * Background retention/reseed maintenance is deliberately non-fatal to the Host, but a failure must not be
   * invisible: until a later maintenance pass succeeds, the panel and diagnostics report that retention may lag.
   */
  readonly maintenance?: {
    readonly retention: 'ok' | 'failed'
    readonly lastFailureAtMs?: number
  }
  /**
   * The browser companion's intake state (ADR 0007). `listening: false` with a
   * reason means the port could not be bound; the panel shows it rather than
   * leaving pairing looking available.
   */
  readonly companion?: {
    readonly listening: boolean
    readonly port?: number
    /** Browser pairing state retained under the original field name. */
    readonly paired: boolean
    readonly editorPaired?: boolean
    /** Most recent authenticated companion contact, regardless of source. */
    readonly lastSeenAtMs?: number | undefined
    /** Source-specific contact times keep Browser and Editor status truthful. */
    readonly browserLastSeenAtMs?: number | undefined
    readonly editorLastSeenAtMs?: number | undefined
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
  /** Companion pairing state (ADR 0007 / ADR 0009). */
  pairing(kind?: CompanionKind): PairingState

  /** Rotate one companion kind's token; the token is returned once. */
  rotatePairing(kind?: CompanionKind): PairingRotation

  /** The audit export: everything this Host knows, as one document. */
  exportAll(): HistoryExport

  /** Merge historical evidence from an export and refresh in-memory ingestion state before resolving. */
  importAll(document: unknown): Promise<{ readonly imported: Record<string, number> }>

  /** The retention choice in force, or the built-in default. */
  retention(): RetentionSettings

  /** Set it. The TTL applies to what is recorded from now on. */
  setRetention(request: {
    readonly observationRetentionHours: number
    readonly episodeRetentionDays: number
  }): RetentionSettings

  /** Episodes grouped into the days they happened on, newest first. */
  timeline(request?: {
    readonly days?: number
  }): Promise<readonly TimelineDay[]>

  /** What the policy would not keep for a scope, using ingestion's own rules. */
  redactionPreview(request: {
    readonly scopeKey: string
  }): RedactionPreview

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
  }): { readonly revoked: boolean; readonly purged: number; readonly forgotten: number }

  /** Bounded deterministic retrieval over retained metadata, no user notes. */
  askHistory(
    request: AskHistoryRequest, signal?: AbortSignal,
  ): Promise<AskHistoryResult>

  /** Local user permission: authorise exactly one note for one Agent read. */
  issueNoteReadCode(
    noteId: string, acknowledged: true, signal?: AbortSignal,
  ): Promise<{ readonly code: string; readonly expiresAtMs: number }>

  /** One-use token, not ambient right to enumerate saved notes. */
  readOneConfirmedNote(
    code: string, signal?: AbortSignal,
  ): Promise<UserMemoryNote | undefined>
  revokeNoteReadCode(code: string, signal?: AbortSignal): Promise<boolean>

  /** Read-only, on-demand memory; no persistent copy or new capture. */
  listProjectMemories(
    request?: ListProjectMemoriesRequest,
    signal?: AbortSignal,
  ): Promise<readonly ProjectMemory[]>

  getProjectMemory(id: string, signal?: AbortSignal): Promise<ProjectMemory | undefined>

  /** Only a current DSH Continue binding permits this additional historical depth. */
  contextualContinue(
    sessionId: string, signal?: AbortSignal,
  ): Promise<ContextualContinueResult>

  /** Read-only candidates, never Skill code, installations or execution. */
  discoverSkillCandidates(
    id: string, signal?: AbortSignal,
  ): Promise<SkillCandidateReport | undefined>

  /** Suggested, non-authoritative cross-app associations; does not alter Work Threads. */
  getThreadActivityLinks(id: string, signal?: AbortSignal): Promise<ThreadActivityLinks | undefined>

  /** User-confirmed notes are separate from automatically derived work facts. */
  listUserMemoryNotes(projectId?: string, signal?: AbortSignal): Promise<readonly UserMemoryNote[]>
  saveUserMemoryNote(
    request: ConfirmUserMemoryNoteRequest, signal?: AbortSignal,
  ): Promise<UserMemoryNote>
  updateUserMemoryNote(
    id: string, text: string, signal?: AbortSignal,
  ): Promise<boolean>
  removeUserMemoryNote(id: string, signal?: AbortSignal): Promise<boolean>
  restoreUserMemoryNotes(
    document: unknown, retentionAcknowledged: true, signal?: AbortSignal,
  ): Promise<{ readonly restored: number; readonly skipped: number }>

  /** Work threads over stored episodes (ADR 0004 §5: each carries citations). */
  threads(request?: { readonly limit?: number }): Promise<readonly WorkThread[]>

  /** Full reader-facing history for one exact stored work thread. */
  thread(
    request: { readonly threadKey: string },
    signal?: AbortSignal,
  ): Promise<WorkThreadDetail | undefined>

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

  /** Persist a metadata-only top-level DSH turn boundary for continuity. */
  recordDshCheckpoint(request: RecordDshCheckpointRequest): DshCheckpoint

  latestDshCheckpoint(request: {
    readonly workspaceId?: string
    readonly workspaceRoot?: string
    readonly atOrBeforeMs: number
  }): DshCheckpoint | undefined

  /** Bind a freshly-created DSH Session to the exact Episode selected by Continue. */
  bindContinuationSession(request: BindContinuationSessionRequest): void

  /** Resolve an explicit Continue capsule without exposing its Episode id in chat text. */
  continuationEpisodeForSession(sessionId: string): EpisodeId | undefined

  /** Remove a failed/abandoned Continue binding without deleting the DSH Session itself. */
  unbindContinuationSession(sessionId: string): boolean

  delete(
    request: DeleteHistoryRequest,
    signal?: AbortSignal,
  ): Promise<DeleteHistoryResult>

  pause(): Promise<void>
  resume(): Promise<void>
  recover(): Promise<void>
  getState(): ComputerHistoryState
  listPolicyRules(): readonly PolicyRule[]
  getPolicy(): PolicySnapshot
  replacePolicy(update: PolicyUpdate): Promise<PolicySnapshot>
}
