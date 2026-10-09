import { EpisodeId } from '../../shared/index.js'
import type {
  BindContinuationSessionRequest,
  CompanionKind,
  PairingRotation,
  PairingState,
  WorkThread,
  ProjectMemory,
  ListProjectMemoriesRequest,
  ConfirmUserMemoryNoteRequest,
  UserMemoryNote,
  WorkThreadDetail,
  ComputerHistoryServiceContract,
  ComputerHistoryState,
  DeleteHistoryRequest,
  DeleteHistoryResult,
  DshCheckpoint,
  EpisodeDetail,
  EpisodeSummary,
  PolicyRule,
  PolicySnapshot,
  PolicyUpdate,
  RecentEpisodesRequest,
  RecordDshCheckpointRequest,
  RedactionPreview,
  RetentionSettings,
  TimelineDay,
  SemanticOptIn,
  SemanticSummaryState,
  ResumeRequest,
  ResumeResolution,
  SearchEpisodesRequest,
} from '../../shared/index.js'
import type { DatabaseSync } from 'node:sqlite'
import {
  exportHistory,
  importHistory,
  type HistoryExport,
} from '../audit/export.js'
import type { CompanionTokenStore } from '../companion/token-store.js'
import type { ObservationId } from '../../shared/index.js'
import { minimiseEpisode, type MinimisedSummaryPayload } from '../semantic/minimise.js'
import { SummaryProviderError } from '../semantic/provider.js'
import { RemoteSendStore } from '../semantic/send-store.js'
import {
  buildRemoteRequestBody,
  RemoteSummaryProvider,
} from '../semantic/remote-provider.js'
import {
  parseScopeKey,
  type SemanticOptInStore,
} from '../semantic/opt-in.js'
import { buildRedactionPreview } from '../audit/preview.js'
import { buildTimeline } from '../../shared/audit-view.js'
import {
  buildWorkThreadDetail,
  buildWorkThreads,
} from '../episodes/threads.js'
import { resolveResume } from '../resume/index.js'
import { buildProjectMemories, memoryIdForThreadKey } from '../memory/index.js'
import { MemoryNoteStore } from '../store/memory-note-store.js'
import { phase1AdapterForBundle } from '../ingestion/index.js'
import {
  DeletionService,
  RetentionService,
} from '../retention/index.js'
import { ObservationStore } from '../store/observation-store.js'
import { RetentionSettingsStore } from '../store/retention-settings.js'
import {
  ContinuationSessionStore,
  DshCheckpointStore,
  EpisodeStore,
  PolicyStore,
} from '../store/index.js'
import type {
  CaptureController,
  LocalBackendConfig,
} from './types.js'

function boundedLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('history limit must be a positive safe integer')
  }
  return Math.min(max, value)
}

export class LocalComputerHistoryBackend
implements ComputerHistoryServiceContract {
  private readonly now: () => number
  private currentRetention: RetentionSettings
  private acceptingOperations = true
  private activeOperations = 0
  private readonly idleWaiters: Array<() => void> = []

  public constructor(
    private readonly episodes: EpisodeStore,
    private readonly policies: PolicyStore,
    private readonly deletion: DeletionService,
    private readonly capture: CaptureController,
    private readonly config: LocalBackendConfig,
    private readonly pairingTokens?: CompanionTokenStore,
    private readonly semanticOptIns?: SemanticOptInStore,
    private readonly db?: DatabaseSync,
    /**
     * A callback rather than the ingestion service itself: the backend needs one
     * number out of it, and a callback keeps the dependency to one function.
     * Appended last so no existing construction moves.
     */
    private readonly refusalCounts?: () => ReadonlyMap<string, number>,
    private readonly firstRunPreset?: () => ComputerHistoryState['firstRunPreset'],
    private readonly release?: () => ComputerHistoryState['release'],
    private readonly maintenance?: () => ComputerHistoryState['maintenance'],
  ) {
    this.now = config.now ?? Date.now
    this.currentRetention = {
      observationRetentionHours: config.observationRetentionHours,
      episodeRetentionDays: config.episodeRetentionDays,
      updatedAtMs: 0,
    }
  }

  private acquireOperation(): () => void {
    if (!this.acceptingOperations) {
      throw new Error('computer history backend is disposing')
    }
    this.activeOperations += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeOperations -= 1
      if (this.activeOperations === 0) {
        for (const resolve of this.idleWaiters.splice(0)) resolve()
      }
    }
  }

  private async withOperation<T>(
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const release = this.acquireOperation()
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private withSynchronousOperation<T>(
    operation: () => T,
  ): T {
    const release = this.acquireOperation()
    try {
      return operation()
    } finally {
      release()
    }
  }

  public drain(): Promise<void> {
    this.acceptingOperations = false
    if (this.activeOperations === 0) return Promise.resolve()
    return new Promise<void>(resolve => {
      this.idleWaiters.push(resolve)
    })
  }

  public listProjectMemories(
    request: ListProjectMemoriesRequest = {},
    signal?: AbortSignal,
  ): Promise<readonly ProjectMemory[]> {
    return this.withOperation(() => {
      signal?.throwIfAborted()
      const query = request.query?.trim()
      if (request.query !== undefined && (!query || query.length > 200)) {
        throw new Error('memory query must be 1..200 characters')
      }
      const nowMs = this.now()
      return buildProjectMemories(this.episodes.listRecent({
        limit: 1_000,
        notExpiredAtMs: nowMs,
      }), {
        ...(query ? { query } : {}),
        limit: boundedLimit(request.limit, 20, 100),
      }, nowMs)
    })
  }

  public getProjectMemory(
    id: string,
    signal?: AbortSignal,
  ): Promise<ProjectMemory | undefined> {
    return this.withOperation(() => {
      signal?.throwIfAborted()
      if (!/^pm_[0-9a-f]{64}$/.test(id)) return undefined
      const nowMs = this.now()
      const threadKey = this.episodes.listMemoryThreadKeys(nowMs)
        .find(key => memoryIdForThreadKey(key) === id)
      if (!threadKey) return undefined
      return buildProjectMemories(
        this.episodes.listByThreadKey(threadKey, 1_000, nowMs),
        { limit: 1 },
        nowMs,
      )[0]
    })
  }

  public listUserMemoryNotes(
    projectId?: string, signal?: AbortSignal,
  ): Promise<readonly UserMemoryNote[]> {
    return this.withOperation(() => {
      signal?.throwIfAborted()
      if (projectId !== undefined && !/^pm_[0-9a-f]{64}$/.test(projectId)) {
        throw new Error('invalid project id')
      }
      return new MemoryNoteStore(this.requireDb()).list(projectId)
    })
  }

  public saveUserMemoryNote(
    request: ConfirmUserMemoryNoteRequest,
    signal?: AbortSignal,
  ): Promise<UserMemoryNote> {
    return this.withOperation(() => {
      signal?.throwIfAborted()
      if (request.retentionAcknowledged !== true
        || !/^pm_[0-9a-f]{64}$/.test(request.projectId)
        || typeof request.episodeId !== 'string'
        || request.episodeId.length < 1
        || request.episodeId.length > 1_000
        || typeof request.text !== 'string') {
        throw new Error('explicit user confirmation and valid source are required')
      }
      const anchor = this.episodes.get(EpisodeId(request.episodeId))
      const nowMs = this.now()
      if (!anchor?.threadKey
        || memoryIdForThreadKey(anchor.threadKey) !== request.projectId) {
        throw new Error('confirmed note source does not match project')
      }
      // A source exists, but must still be valid at current retention time.
      const project = buildProjectMemories(
        this.episodes.listByThreadKey(anchor.threadKey, 1_000, nowMs),
        { limit: 1 }, nowMs,
      )[0]
      if (!project || project.id !== request.projectId) {
        throw new Error('project source is no longer retained')
      }
      return new MemoryNoteStore(this.requireDb()).save({
        threadKey: anchor.threadKey,
        projectLabel: project.title,
        text: request.text,
        anchor,
      }, nowMs)
    })
  }

  public updateUserMemoryNote(
    id: string, noteText: string, signal?: AbortSignal,
  ): Promise<boolean> {
    return this.withOperation(() => {
      signal?.throwIfAborted()
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('invalid memory note id')
      }
      return new MemoryNoteStore(this.requireDb()).update(id, noteText, this.now())
    })
  }

  public removeUserMemoryNote(id: string, signal?: AbortSignal): Promise<boolean> {
    return this.withOperation(() => {
      signal?.throwIfAborted()
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('invalid memory note id')
      }
      return new MemoryNoteStore(this.requireDb()).remove(id)
    })
  }

  public restoreUserMemoryNotes(
    document: unknown, retentionAcknowledged: true, signal?: AbortSignal,
  ): Promise<{ readonly restored: number; readonly skipped: number }> {
    return this.withOperation(() => {
      signal?.throwIfAborted()
      if (retentionAcknowledged !== true) {
        throw new Error('explicit restore confirmation required')
      }
      return new MemoryNoteStore(this.requireDb()).restoreExport(document, true)
    })
  }

  public threads(
    request: { readonly limit?: number } = {},
  ): Promise<readonly WorkThread[]> {
    return this.withOperation(() => buildWorkThreads(
      this.episodes.listRecent({ limit: 1_000 }),
      { limit: boundedLimit(request.limit, 5, 100) },
    ))
  }

  public thread(
    request: { readonly threadKey: string },
    _signal?: AbortSignal,
  ): Promise<WorkThreadDetail | undefined> {
    return this.withOperation(() => buildWorkThreadDetail(
      this.episodes.listByThreadKey(request.threadKey, 1_000),
    ))
  }

  public recent(
    request: RecentEpisodesRequest = {},
    _signal?: AbortSignal,
  ): Promise<readonly EpisodeSummary[]> {
    return this.withOperation(() => this.episodes.listRecent({
      ...(request.sinceMs === undefined
        ? {}
        : { sinceMs: request.sinceMs }),
      ...(request.workspaceId
        ? { workspaceId: request.workspaceId }
        : {}),
      limit: boundedLimit(request.limit, 5, 100),
    }))
  }

  public search(
    request: SearchEpisodesRequest,
    _signal?: AbortSignal,
  ): Promise<readonly EpisodeSummary[]> {
    return this.withOperation(() => {
      const query = request.query.trim()
      if (query.length < 1 || query.length > 500) {
        throw new Error(
          'history search query must contain 1..500 characters',
        )
      }

      return this.episodes.search({
        query,
        ...(request.sinceMs === undefined
          ? {}
          : { sinceMs: request.sinceMs }),
        ...(request.untilMs === undefined
          ? {}
          : { untilMs: request.untilMs }),
        ...(request.workspaceId
          ? { workspaceId: request.workspaceId }
          : {}),
        ...(request.bundleId
          ? { bundleId: request.bundleId }
          : {}),
        limit: boundedLimit(request.limit, 5, 100),
      })
    })
  }

  public getEpisode(
    id: EpisodeId,
    _signal?: AbortSignal,
  ): Promise<EpisodeDetail | undefined> {
    return this.withOperation(() => this.episodes.get(id))
  }

  public resolveResume(
    request: ResumeRequest,
    _signal?: AbortSignal,
  ): Promise<ResumeResolution> {
    return this.withOperation(() => resolveResume(
      this.episodes.listRecent({ limit: 500 }),
      request,
    ))
  }

  public recordDshCheckpoint(
    request: RecordDshCheckpointRequest,
  ): DshCheckpoint {
    if (!Number.isSafeInteger(request.turn) || request.turn < 1) {
      throw new Error('DSH checkpoint turn must be a positive safe integer')
    }
    if (!Number.isFinite(request.checkpointAtMs)) {
      throw new Error('DSH checkpoint time must be finite')
    }
    const expiresAtMs = request.checkpointAtMs
      + this.config.episodeRetentionDays * 86_400_000
    return new DshCheckpointStore(this.requireDb()).upsert(request, expiresAtMs)
  }

  public latestDshCheckpoint(request: {
    readonly workspaceId?: string
    readonly workspaceRoot?: string
    readonly atOrBeforeMs: number
  }): DshCheckpoint | undefined {
    return new DshCheckpointStore(this.requireDb()).latestForWorkspace(request)
  }

  public bindContinuationSession(
    request: BindContinuationSessionRequest,
  ): void {
    if (
      request.sessionId.length < 1
      || request.sessionId.length > 512
      || String(request.episodeId).length < 1
      || String(request.episodeId).length > 1_000
    ) {
      throw new Error('invalid continuation session binding')
    }
    if (!this.episodes.get(request.episodeId)) {
      throw new Error('continuation episode not found')
    }
    const nowMs = this.now()
    const expiresAtMs = nowMs
      + this.config.episodeRetentionDays * 86_400_000
    new ContinuationSessionStore(this.requireDb()).bind(
      request,
      nowMs,
      expiresAtMs,
    )
  }

  public continuationEpisodeForSession(
    sessionId: string,
  ): EpisodeId | undefined {
    if (sessionId.length < 1 || sessionId.length > 512) return undefined
    return new ContinuationSessionStore(this.requireDb())
      .episodeForSession(sessionId, this.now())
  }

  public unbindContinuationSession(
    sessionId: string,
  ): boolean {
    if (sessionId.length < 1 || sessionId.length > 512) return false
    return new ContinuationSessionStore(this.requireDb())
      .deleteSession(sessionId)
  }

  public async delete(
    request: DeleteHistoryRequest,
    _signal?: AbortSignal,
  ): Promise<DeleteHistoryResult> {
    // The rebuild is part of the same tracked operation: `drain()` must
    // not resolve while a post-deletion reseed is still writing.
    return this.withOperation(async () => {
      try {
        return this.deletion.delete(request, this.now())
      } finally {
        await this.config.onHistoryChanged?.()
      }
    })
  }

  public pause(): Promise<void> {
    return this.withOperation(() => this.capture.pause())
  }

  public resume(): Promise<void> {
    return this.withOperation(() => this.capture.resume())
  }

  public recover(): Promise<void> {
    return this.withOperation(() => this.capture.recover())
  }

  public getState(): ComputerHistoryState {
    return this.withSynchronousOperation(() => {
      // Retention is shared SQLite state, not Host-local state. Another Host may
      // change it while this process keeps running; refresh it before composing
      // /state so the UI cannot disagree with the TTL ingestion is actually using.
      if (this.db) {
        this.currentRetention = new RetentionSettingsStore(this.db).get()
      }
      const maintenance = this.maintenance?.()
      return {
        ...this.capture.getState(),
        // Why things were refused, when the host can tell us: a bare count is a
        // number, and this is the sentence a new installation needs.
        ...(this.refusalCounts
          ? { refusedByReason: Object.fromEntries(this.refusalCounts()) }
          : {}),
        ...(this.firstRunPreset
          ? { firstRunPreset: this.firstRunPreset() }
          : {}),
        ...(this.release ? { release: this.release() } : {}),
        ...(maintenance === undefined ? {} : { maintenance }),
        observationRetentionHours:
          this.currentRetention.observationRetentionHours,
        episodeRetentionDays:
          this.currentRetention.episodeRetentionDays,
        autoResume: this.config.autoResume,
      }
    })
  }

  private pairingNow(kind: CompanionKind): PairingState {
    const state = this.pairingTokens?.state(kind) ?? { paired: false }
    const companion = this.capture.getCompanionState?.()
    return {
      ...state,
      listening: companion?.listening ?? false,
      ...(companion?.port === undefined ? {} : { port: companion.port }),
    }
  }

  public pairing(kind: CompanionKind = 'browser'): PairingState {
    return this.withSynchronousOperation(() => this.pairingNow(kind))
  }

  /** Rotate one companion kind without invalidating the other. */
  public rotatePairing(kind: CompanionKind = 'browser'): PairingRotation {
    return this.withSynchronousOperation(() => {
      if (!this.pairingTokens) {
        throw new Error('companion pairing is unavailable')
      }
      const token = this.pairingTokens.rotate(kind, this.now())
      return { ...this.pairingNow(kind), token }
    })
  }

  /**
   * Rotate a credential and publish its cleartext handoff as one tracked Host
   * operation. The publisher is intentionally synchronous: filesystem staging
   * is the only supported use, so teardown can either reject before touching
   * SQLite or wait until the rotate/publish/compensate sequence is complete.
   */
  public publishPairingRotation<T>(
    kind: CompanionKind,
    publish: (rotation: PairingRotation) => T,
  ): T {
    return this.withSynchronousOperation(() => {
      if (!this.pairingTokens) {
        throw new Error('companion pairing is unavailable')
      }
      const checkpoint = this.pairingTokens.checkpoint(kind)
      const token = this.pairingTokens.rotate(kind, this.now())
      const rotation = { ...this.pairingNow(kind), token }
      try {
        return publish(rotation)
      } catch (error) {
        this.pairingTokens.restore(kind, checkpoint, token)
        throw error
      }
    })
  }

  /**
   * Who produces summaries, per scope (ADR 0004 §4). `active` is what a fresh
   * episode would get today: deterministic text is always available, and a
   * model only when a scope is switched on.
   */
  public semanticState(): SemanticSummaryState {
    return this.withSynchronousOperation(() => {
      const providers = this.config.semanticProviders
      return {
        active: 'deterministic',
        providers: {
          local: providers?.local
            ? { available: true, model: providers.local.model }
            : { available: false, reason: 'not-wired' },
          remote: providers?.remote
            ? { available: true, model: providers.remote.model }
            : { available: false, reason: 'not-wired' },
        },
        scopes: this.semanticOptIns?.list() ?? [],
      }
    })
  }

  /** The exact payload a provider would see for this scope (ADR 0004 §4). */
  public semanticPreview(
    request: { readonly scopeKey: string },
  ): MinimisedSummaryPayload | undefined {
    return this.withSynchronousOperation(() => this.semanticPreviewNow(request))
  }

  private semanticPreviewNow(
    request: { readonly scopeKey: string },
  ): MinimisedSummaryPayload | undefined {
    const episode = this.latestEpisodeForScope(request.scopeKey)
    if (!episode) return undefined
    const detail: EpisodeSummary = this.episodes.get(episode.id) ?? episode
    return minimiseEpisode({
      resources: detail.resources,
      surfaces: detail.surfaces,
      observationIds: detail.summaryObservationIds,
      startedAtMs: detail.startedAtMs,
      endedAtMs: detail.endedAtMs,
      ...(detail.threadKey === undefined ? {} : { threadKey: detail.threadKey }),
      ...(detail.workspace === undefined ? {} : { workspace: detail.workspace }),
    })
  }

  /**
   * The exact bytes a remote call would send, for the panel to show before the
   * user switches a scope on (ADR 0010). Built by the same function the
   * provider uses, so it cannot drift from what is actually sent.
   */
  public semanticRemotePreview(request: {
    readonly scopeKey: string
    readonly model: string
  }): { readonly payload: MinimisedSummaryPayload, readonly body: string } | undefined {
    return this.withSynchronousOperation(() => {
      const payload = this.semanticPreviewNow({ scopeKey: request.scopeKey })
      if (!payload) return undefined
      const citations = this.citationsForScope(request.scopeKey)
      return {
        payload,
        body: buildRemoteRequestBody({
          model: request.model,
          payload,
          observationIds: citations,
        }),
      }
    })
  }

  /**
   * Produce a summary remotely, and record that it happened (ADR 0010). The
   * provider refuses without a recorded opt-in, so a scope the user has not
   * enabled cannot reach this far.
   */
  public summariseRemotely(request: {
    readonly scopeKey: string
    readonly endpoint: string
    readonly model: string
    readonly fetchImpl?: typeof fetch
  }): Promise<{ readonly summary: string, readonly sendId: number }> {
    return this.withOperation(async () => {
      const payload = this.semanticPreviewNow({ scopeKey: request.scopeKey })
      if (!payload) throw new SummaryProviderError('no episode for that scope')
      const citations = this.citationsForScope(request.scopeKey)
      const scope = parseScopeKey(request.scopeKey)
      if (!this.semanticOptIns) {
        throw new SummaryProviderError('semantic summaries are unavailable')
      }
      const sends = new RemoteSendStore(this.requireDb())
      const episodeId = this.episodeIdForScope(request.scopeKey)
      let lastSendId = 0
      const provider = new RemoteSummaryProvider({
        endpoint: request.endpoint,
        model: request.model,
        optIns: this.semanticOptIns,
        ...(request.fetchImpl ? { fetchImpl: request.fetchImpl } : {}),
        now: () => this.now(),
        onSent: (record) => {
          lastSendId = sends.record({
            ...record,
            scopeKey: request.scopeKey,
            ...(episodeId === undefined ? {} : { episodeId }),
          })
        },
      })
      const summary = await provider.summarise({ scope, payload, citations })
      return { summary, sendId: lastSendId }
    })
  }

  private latestEpisodeForScope(scopeKey: string): EpisodeSummary | undefined {
    const scope = parseScopeKey(scopeKey)
    return scope.kind === 'workspace'
      ? this.episodes.latestForWorkspace(scope.id)
      : this.episodes.latestForBundle(scope.bundleId)
  }

  /** The episode a scope points at, and the citations behind its summary. */
  private episodeIdForScope(scopeKey: string): EpisodeId | undefined {
    return this.latestEpisodeForScope(scopeKey)?.id
  }

  private citationsForScope(scopeKey: string): readonly ObservationId[] {
    const episodeId = this.episodeIdForScope(scopeKey)
    if (episodeId === undefined) return []
    return this.episodes.get(episodeId)?.summaryObservationIds ?? []
  }

  public grantSemanticOptIn(request: {
    readonly scopeKey: string
    readonly providerKind: 'local' | 'remote'
    readonly model?: string
  }): SemanticOptIn {
    return this.withSynchronousOperation(() => {
      if (!this.semanticOptIns) {
        throw new SummaryProviderError('semantic summaries are unavailable')
      }
      const provider = this.config.semanticProviders?.[request.providerKind]
      if (!provider) {
        throw new SummaryProviderError(
          `${request.providerKind} summary provider is not available on this Host`,
        )
      }
      return this.semanticOptIns.grant(
        parseScopeKey(request.scopeKey),
        request.providerKind,
        request.model,
        this.now(),
      )
    })
  }

  /**
   * "Turn off and purge" (ADR 0004, Consequences): the permission goes, and so
   * does every derived summary of that scope that a model produced. The
   * deterministic text is not touched, because it never left the machine.
   */
  public revokeSemanticOptIn(request: {
    readonly scopeKey: string
  }): {
    readonly revoked: boolean
    readonly purged: number
    /** Local send records forgotten by this revocation (ADR 0010). */
    readonly forgotten: number
  } {
    return this.withSynchronousOperation(() => {
      if (!this.semanticOptIns) {
        throw new Error('semantic summaries are unavailable')
      }
      const db = this.requireDb()
      if (db.isTransaction) {
        throw new Error('semantic revocation must own the outer transaction')
      }
      const scope = parseScopeKey(request.scopeKey)
      db.exec('BEGIN IMMEDIATE')
      try {
        const revoked = this.semanticOptIns.revoke(scope)
        const purged = this.semanticOptIns.purge(scope)
        // Revoking is an instruction to forget, so the local record of what left
        // goes too (ADR 0010). These three writes are one user action: a failure
        // after the permission row is removed must roll the whole action back
        // rather than leave model output or send audit rows behind.
        const forgotten = new RemoteSendStore(db)
          .deleteForScope(request.scopeKey)
        db.exec('COMMIT')
        return { revoked, purged, forgotten }
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK')
        throw error
      }
    })
  }


  /** The whole store as one document, for the audit export. */
  public exportAll(): HistoryExport {
    return this.withSynchronousOperation(
      () => exportHistory(this.requireDb(), this.now()),
    )
  }

  public importAll(
    document: unknown,
  ): Promise<{ readonly imported: Record<string, number> }> {
    return this.withOperation(async () => {
      const db = this.requireDb()
      const result = importHistory(db, document)
      // An export carries the absolute TTL stamped on each row. Do not expose
      // already-expired imported evidence until the 15-minute maintenance pass:
      // enforce those persisted deadlines before rebuilding live ingestion state
      // or reporting the import complete.
      new RetentionService(db).sweep(this.now())
      // importHistory writes through this same SQLite connection, so PRAGMA
      // data_version cannot be relied on to make ingestion notice the change
      // later. Reseed explicitly after retention has removed any expired tail.
      await this.config.onHistoryChanged?.()
      return result
    })
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw new Error('the audit export is unavailable')
    return this.db
  }

  /** Episodes grouped into the days they happened on, newest first. */
  public timeline(
    request: { readonly days?: number } = {},
  ): Promise<readonly TimelineDay[]> {
    return this.withOperation(() => buildTimeline(
      this.episodes.listRecent({ limit: 1_000 }),
      { days: boundedLimit(request.days, 1, 31) },
    ))
  }

  /**
   * What the current policy would not have kept for this scope, computed by the
   * ingestion predicates themselves (see audit/preview.ts).
   */
  public redactionPreview(request: {
    readonly scopeKey: string
  }): RedactionPreview {
    return this.withSynchronousOperation(() => {
      const scope = parseScopeKey(request.scopeKey)
      const observations = new ObservationStore(this.requireDb()).listAll()
      const scoped = scope.kind === 'app'
        ? observations.filter(item => item.app.bundleId === scope.bundleId)
        : observations.filter(item => item.workspace.id === scope.id)
      return buildRedactionPreview({
        scopeKey: request.scopeKey,
        policy: this.policies.get(),
        observations: scoped,
      })
    })
  }

  public retention(): RetentionSettings {
    return this.withSynchronousOperation(() => {
      const retention = new RetentionSettingsStore(this.requireDb()).get()
      this.currentRetention = retention
      return retention
    })
  }

  public setRetention(input: {
    readonly observationRetentionHours: number
    readonly episodeRetentionDays: number
  }): RetentionSettings {
    return this.withSynchronousOperation(() => {
      const retention = new RetentionSettingsStore(this.requireDb())
        .set(input, this.now())
      // /state is polled independently from /retention. Keep the runtime snapshot
      // in step immediately so a successful save is not overwritten two seconds
      // later by the startup values.
      this.currentRetention = retention
      return retention
    })
  }

  public listPolicyRules(): readonly PolicyRule[] {
    return this.withSynchronousOperation(() => this.policies.get().rules)
  }

  public getPolicy(): PolicySnapshot {
    return this.withSynchronousOperation(() => this.policies.get())
  }

  public async replacePolicy(
    update: PolicyUpdate,
  ): Promise<PolicySnapshot> {
    return this.withOperation(() =>
      this.replacePolicyNow(update))
  }

  private async replacePolicyNow(
    update: PolicyUpdate,
  ): Promise<PolicySnapshot> {
    if (update.mode !== 'include-only') {
      throw new Error(
        'Phase 1 requires include-only capture policy',
      )
    }
    if (update.rules.length > 256) {
      throw new Error('Phase 1 policy contains too many rules')
    }

    const ids = new Set<string>()
    for (const rule of update.rules) {
      const id = String(rule.id)
      if (ids.has(id)) {
        throw new Error(
          `Phase 1 policy contains duplicate rule id: ${id}`,
        )
      }
      ids.add(id)
    }

    const unsupported = update.rules.find(
      rule => rule.dimension === 'app'
        && rule.action === 'allow'
        && (
          rule.matcher !== 'exact'
          || !phase1AdapterForBundle(rule.pattern)
        ),
    )
    if (unsupported) {
      throw new Error(
        `Phase 1 cannot capture unsupported app bundle: ${unsupported.pattern}`,
      )
    }

    const releasePolicyLease =
      await this.config.acquirePolicyChangeLease?.()
        ?? (async () => {})

    try {
      const current = this.policies.get()
      const builtIns = new Map(
        current.rules
          .filter(rule => rule.builtIn)
          .map(rule => [String(rule.id), rule] as const),
      )

      for (const rule of update.rules) {
        const id = String(rule.id)
        const builtIn = builtIns.get(id)
        if (rule.builtIn) {
          if (
            !builtIn
            || rule.dimension !== builtIn.dimension
            || rule.action !== builtIn.action
            || rule.matcher !== builtIn.matcher
            || rule.pattern !== builtIn.pattern
          ) {
            throw new Error(
              `Phase 1 policy contains invalid built-in rule: ${id}`,
            )
          }
        } else if (builtIn) {
          throw new Error(
            `Phase 1 policy rule id is reserved: ${id}`,
          )
        }
      }

      const snapshot = this.policies.replace(
        update.mode,
        update.rules,
        this.now(),
      )
      await this.config.onPolicyChanged?.(snapshot)
      return snapshot
    } finally {
      await releasePolicyLease()
    }
  }
}
