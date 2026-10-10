import {
  Service,
  type Context,
} from '@deepseek-ai/cordis'
import type {
  BindContinuationSessionRequest,
  CompanionKind,
  ComputerHistoryServiceContract,
  ComputerHistoryState,
  DeleteHistoryRequest,
  DeleteHistoryResult,
  DshCheckpoint,
  EpisodeDetail,
  EpisodeId,
  EpisodeSummary,
  HistoryExport,
  MinimisedSummaryPayload,
  PairingRotation,
  RedactionPreview,
  RetentionSettings,
  TimelineDay,
  PairingState,
  SemanticOptIn,
  SemanticSummaryState,
  WorkThread,
  AskHistoryRequest,
  AskHistoryResult,
  ProjectMemory,
  ThreadActivityLinks,
  SkillCandidateReport,
  ContextualContinueResult,
  ListProjectMemoriesRequest,
  ConfirmUserMemoryNoteRequest,
  UserMemoryNote,
  WorkThreadDetail,
  PolicyRule,
  PolicySnapshot,
  PolicyUpdate,
  RecentEpisodesRequest,
  RecordDshCheckpointRequest,
  ResumeRequest,
  ResumeResolution,
  SearchEpisodesRequest,
} from '../../shared/index.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    computerHistory: ComputerHistoryService
  }
}

export interface ComputerHistoryServiceOptions {
  readonly backend: ComputerHistoryServiceContract
}

export class ComputerHistoryService
  extends Service
  implements ComputerHistoryServiceContract {  private readonly backend: ComputerHistoryServiceContract

  public constructor(
    ctx: Context,
    options: ComputerHistoryServiceOptions,
  ) {
    super(ctx, 'computerHistory')
    this.backend = options.backend
  }

  public recent(
    request?: RecentEpisodesRequest,
    signal?: AbortSignal,
  ): Promise<readonly EpisodeSummary[]> {
    return this.backend.recent(request, signal)
  }

  public search(
    request: SearchEpisodesRequest,
    signal?: AbortSignal,
  ): Promise<readonly EpisodeSummary[]> {
    return this.backend.search(request, signal)
  }

  public getEpisode(
    id: EpisodeId,
    signal?: AbortSignal,
  ): Promise<EpisodeDetail | undefined> {
    return this.backend.getEpisode(id, signal)
  }

  public resolveResume(
    request: ResumeRequest,
    signal?: AbortSignal,
  ): Promise<ResumeResolution> {
    return this.backend.resolveResume(request, signal)
  }

  public recordDshCheckpoint(
    request: RecordDshCheckpointRequest,
  ): DshCheckpoint {
    return this.backend.recordDshCheckpoint(request)
  }

  public latestDshCheckpoint(request: {
    readonly workspaceId?: string
    readonly workspaceRoot?: string
    readonly atOrBeforeMs: number
  }): DshCheckpoint | undefined {
    return this.backend.latestDshCheckpoint(request)
  }

  public bindContinuationSession(
    request: BindContinuationSessionRequest,
  ): void {
    this.backend.bindContinuationSession(request)
  }

  public continuationEpisodeForSession(
    sessionId: string,
  ): EpisodeId | undefined {
    return this.backend.continuationEpisodeForSession(sessionId)
  }

  public unbindContinuationSession(
    sessionId: string,
  ): boolean {
    return this.backend.unbindContinuationSession(sessionId)
  }

  public delete(
    request: DeleteHistoryRequest,
    signal?: AbortSignal,
  ): Promise<DeleteHistoryResult> {
    return this.backend.delete(request, signal)
  }

  public pause(): Promise<void> {
    return this.backend.pause()
  }

  public resume(): Promise<void> {
    return this.backend.resume()
  }

  public recover(): Promise<void> {
    return this.backend.recover()
  }

  public getState(): ComputerHistoryState {
    return this.backend.getState()
  }

  public askHistory(
    request: AskHistoryRequest, signal?: AbortSignal,
  ): Promise<AskHistoryResult> {
    return this.backend.askHistory(request, signal)
  }

  public issueNoteReadCode(
    noteId: string, acknowledged: true, signal?: AbortSignal,
  ): Promise<{ readonly code: string; readonly expiresAtMs: number }> {
    return this.backend.issueNoteReadCode(noteId, acknowledged, signal)
  }

  public readOneConfirmedNote(
    code: string, signal?: AbortSignal,
  ): Promise<UserMemoryNote | undefined> {
    return this.backend.readOneConfirmedNote(code, signal)
  }

  public revokeNoteReadCode(code: string, signal?: AbortSignal): Promise<boolean> {
    return this.backend.revokeNoteReadCode(code, signal)
  }

  public listProjectMemories(
    request?: ListProjectMemoriesRequest,
    signal?: AbortSignal,
  ): Promise<readonly ProjectMemory[]> {
    return this.backend.listProjectMemories(request, signal)
  }

  public contextualContinue(
    sessionId: string, signal?: AbortSignal,
  ): Promise<ContextualContinueResult> {
    return this.backend.contextualContinue(sessionId, signal)
  }

  public discoverSkillCandidates(
    id: string, signal?: AbortSignal,
  ): Promise<SkillCandidateReport | undefined> {
    return this.backend.discoverSkillCandidates(id, signal)
  }

  public getThreadActivityLinks(
    id: string, signal?: AbortSignal,
  ): Promise<ThreadActivityLinks | undefined> {
    return this.backend.getThreadActivityLinks(id, signal)
  }

  public getProjectMemory(
    id: string, signal?: AbortSignal,
  ): Promise<ProjectMemory | undefined> {
    return this.backend.getProjectMemory(id, signal)
  }

  public listUserMemoryNotes(
    projectId?: string, signal?: AbortSignal,
  ): Promise<readonly UserMemoryNote[]> {
    return this.backend.listUserMemoryNotes(projectId, signal)
  }

  public saveUserMemoryNote(
    request: ConfirmUserMemoryNoteRequest, signal?: AbortSignal,
  ): Promise<UserMemoryNote> {
    return this.backend.saveUserMemoryNote(request, signal)
  }

  public updateUserMemoryNote(
    id: string, text: string, signal?: AbortSignal,
  ): Promise<boolean> {
    return this.backend.updateUserMemoryNote(id, text, signal)
  }

  public removeUserMemoryNote(id: string, signal?: AbortSignal): Promise<boolean> {
    return this.backend.removeUserMemoryNote(id, signal)
  }

  public restoreUserMemoryNotes(
    document: unknown, retentionAcknowledged: true, signal?: AbortSignal,
  ): Promise<{ readonly restored: number; readonly skipped: number }> {
    return this.backend.restoreUserMemoryNotes(document, retentionAcknowledged, signal)
  }

  public threads(
    request: { readonly limit?: number } = {},
  ): Promise<readonly WorkThread[]> {
    return this.backend.threads(request)
  }

  public thread(
    request: { readonly threadKey: string },
    signal?: AbortSignal,
  ): Promise<WorkThreadDetail | undefined> {
    return this.backend.thread(request, signal)
  }

  public exportAll(): HistoryExport {
    return this.backend.exportAll()
  }

  public importAll(
    document: unknown,
  ): Promise<{ readonly imported: Record<string, number> }> {
    return this.backend.importAll(document)
  }

  public timeline(
    request: { readonly days?: number } = {},
  ): Promise<readonly TimelineDay[]> {
    return this.backend.timeline(request)
  }

  public retention(): RetentionSettings {
    return this.backend.retention()
  }

  public setRetention(input: {
    readonly observationRetentionHours: number
    readonly episodeRetentionDays: number
  }): RetentionSettings {
    return this.backend.setRetention(input)
  }

  public redactionPreview(request: {
    readonly scopeKey: string
  }): RedactionPreview {
    return this.backend.redactionPreview(request)
  }

  public semanticState(): SemanticSummaryState {
    return this.backend.semanticState()
  }

  public semanticPreview(request: {
    readonly scopeKey: string
  }): MinimisedSummaryPayload | undefined {
    return this.backend.semanticPreview(request)
  }

  public grantSemanticOptIn(request: {
    readonly scopeKey: string
    readonly providerKind: 'local' | 'remote'
    readonly model?: string
  }): SemanticOptIn {
    return this.backend.grantSemanticOptIn(request)
  }

  public revokeSemanticOptIn(request: {
    readonly scopeKey: string
  }): {
    readonly revoked: boolean
    readonly purged: number
    readonly forgotten: number
  } {
    return this.backend.revokeSemanticOptIn(request)
  }

  public pairing(kind: CompanionKind = 'browser'): PairingState {
    return this.backend.pairing(kind)
  }

  public rotatePairing(kind: CompanionKind = 'browser'): PairingRotation {
    return this.backend.rotatePairing(kind)
  }

  public listPolicyRules(): readonly PolicyRule[] {
    return this.backend.listPolicyRules()
  }

  public getPolicy(): PolicySnapshot {
    return this.backend.getPolicy()
  }

  public replacePolicy(
    update: PolicyUpdate,
  ): Promise<PolicySnapshot> {
    return this.backend.replacePolicy(update)
  }
}

/**
 * Read this plugin's own `computerHistory` service without the cordis inject
 * gate.
 *
 * The service is provided by a child fiber mounted inside the plugin, so the
 * plugin's own consumers cannot declare it in `inject` — waiting for a service
 * the same apply() provides would deadlock the provider. Accessing
 * `ctx.computerHistory` therefore throws
 * `cannot get property "computerHistory" without inject` at runtime, which is
 * invisible to tests that pass a plain context stub. `ctx.get()` is cordis's
 * documented inject-free accessor; use this helper instead of the property.
 */
export function computerHistoryService(
  ctx: Context,
): ComputerHistoryService {
  const service = ctx.get('computerHistory') as
    | ComputerHistoryService
    | undefined
  if (!service) {
    throw new Error('computerHistory service is not available')
  }
  return service
}
