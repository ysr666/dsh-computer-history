import type {
  PairingRotation,
  PairingState,
  WorkThread,
  WorkThreadDetail,
  ComputerHistoryServiceContract,
  ComputerHistoryState,
  DeleteHistoryRequest,
  DeleteHistoryResult,
  EpisodeDetail,
  EpisodeId,
  EpisodeSummary,
  PolicyRule,
  PolicySnapshot,
  PolicyUpdate,
  RecentEpisodesRequest,
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
import { phase1AdapterForBundle } from '../ingestion/index.js'
import { DeletionService } from '../retention/index.js'
import { ObservationStore } from '../store/observation-store.js'
import { RetentionSettingsStore } from '../store/retention-settings.js'
import {
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
  ) {
    this.now = config.now ?? Date.now
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

  public drain(): Promise<void> {
    this.acceptingOperations = false
    if (this.activeOperations === 0) return Promise.resolve()
    return new Promise<void>(resolve => {
      this.idleWaiters.push(resolve)
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
    return this.capture.pause()
  }

  public resume(): Promise<void> {
    return this.capture.resume()
  }

  public getState(): ComputerHistoryState {
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
      observationRetentionHours:
        this.config.observationRetentionHours,
      episodeRetentionDays:
        this.config.episodeRetentionDays,
      autoResume: this.config.autoResume,
    }
  }

  public pairing(): PairingState {
    const state = this.pairingTokens?.state() ?? { paired: false }
    const companion = this.capture.getCompanionState?.()
    return {
      ...state,
      listening: companion?.listening ?? false,
      ...(companion?.port === undefined ? {} : { port: companion.port }),
    }
  }

  /**
   * Rotate the companion token. The caller must show it once: only the digest
   * is stored (ADR 0007), so it cannot be read back later.
   */
  public rotatePairing(): PairingRotation {
    if (!this.pairingTokens) {
      throw new Error('companion pairing is unavailable')
    }
    const token = this.pairingTokens.rotate(this.now())
    return { ...this.pairing(), token }
  }

  /**
   * Who produces summaries, per scope (ADR 0004 §4). `active` is what a fresh
   * episode would get today: deterministic text is always available, and a
   * model only when a scope is switched on.
   */
  public semanticState(): SemanticSummaryState {
    return {
      active: 'deterministic',
      localProviderConfigured: false,
      scopes: this.semanticOptIns?.list() ?? [],
    }
  }

  /** The exact payload a provider would see for this scope (ADR 0004 §4). */
  public semanticPreview(
    request: { readonly scopeKey: string },
  ): MinimisedSummaryPayload | undefined {
    const [kind, ...rest] = request.scopeKey.split(':')
    const id = rest.join(':')
    const episodes = this.episodes.listRecent({ limit: 50 })
    const episode = kind === 'workspace'
      ? episodes.find(item => item.workspace?.id === id)
      : episodes.find(item => item.surfaces.some(surface => surface.bundleId === id))
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
    const payload = this.semanticPreview({ scopeKey: request.scopeKey })
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
  }

  /**
   * Produce a summary remotely, and record that it happened (ADR 0010). The
   * provider refuses without a recorded opt-in, so a scope the user has not
   * enabled cannot reach this far.
   */
  public async summariseRemotely(request: {
    readonly scopeKey: string
    readonly endpoint: string
    readonly model: string
    readonly fetchImpl?: typeof fetch
  }): Promise<{ readonly summary: string, readonly sendId: number }> {
    const payload = this.semanticPreview({ scopeKey: request.scopeKey })
    if (!payload) throw new SummaryProviderError('no episode for that scope')
    const citations = this.citationsForScope(request.scopeKey)
    const scope = parseScopeKey(request.scopeKey)
    if (!this.semanticOptIns) {
      throw new SummaryProviderError('semantic summaries are unavailable')
    }
    const sends = new RemoteSendStore(this.requireDb())
    const episodeId = this.episodeIdForScope(request.scopeKey)
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
    let lastSendId = 0
    const summary = await provider.summarise({ scope, payload, citations })
    return { summary, sendId: lastSendId }
  }

  /** The episode a scope points at, and the citations behind its summary. */
  private episodeIdForScope(scopeKey: string): EpisodeId | undefined {
    const [kind, ...rest] = scopeKey.split(':')
    const id = rest.join(':')
    const episodes = this.episodes.listRecent({ limit: 50 })
    const episode = kind === 'workspace'
      ? episodes.find(item => item.workspace?.id === id)
      : episodes.find(item => item.surfaces.some(surface => surface.bundleId === id))
    return episode?.id
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
    if (!this.semanticOptIns) {
      throw new Error('semantic summaries are unavailable')
    }
    return this.semanticOptIns.grant(
      parseScopeKey(request.scopeKey),
      request.providerKind,
      request.model,
      this.now(),
    )
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
    if (!this.semanticOptIns) {
      throw new Error('semantic summaries are unavailable')
    }
    const revoked = this.semanticOptIns.revoke(parseScopeKey(request.scopeKey))
    const purged = this.semanticOptIns.purge(parseScopeKey(request.scopeKey))
    // Revoking is an instruction to forget, so the local record of what left
    // goes too (ADR 0010). The remote side cannot be recalled, and the panel
    // says so rather than letting this number imply otherwise.
    const forgotten = new RemoteSendStore(this.requireDb())
      .deleteForScope(request.scopeKey)
    return { revoked, purged, forgotten }
  }


  /** The whole store as one document, for the audit export. */
  public exportAll(): HistoryExport {
    return exportHistory(this.requireDb(), this.now())
  }

  public importAll(
    document: unknown,
  ): { readonly imported: Record<string, number> } {
    return importHistory(this.requireDb(), document)
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
    const [kind, ...rest] = request.scopeKey.split(':')
    const id = rest.join(':')
    const observations = new ObservationStore(this.requireDb()).listAll()
    const scoped = kind === 'app'
      ? observations.filter(item => item.app.bundleId === id)
      : observations.filter(item => item.workspace.id === id)
    return buildRedactionPreview({
      scopeKey: request.scopeKey,
      policy: this.policies.get(),
      observations: scoped,
    })
  }

  public retention(): RetentionSettings {
    return new RetentionSettingsStore(this.requireDb()).get()
  }

  public setRetention(input: {
    readonly observationRetentionHours: number
    readonly episodeRetentionDays: number
  }): RetentionSettings {
    return new RetentionSettingsStore(this.requireDb())
      .set(input, this.now())
  }

  public listPolicyRules(): readonly PolicyRule[] {
    return this.policies.get().rules
  }

  public getPolicy(): PolicySnapshot {
    return this.policies.get()
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
