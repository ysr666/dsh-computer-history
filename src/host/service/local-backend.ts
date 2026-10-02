import type {
  PairingRotation,
  PairingState,
  WorkThread,
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
  ResumeRequest,
  ResumeResolution,
  SearchEpisodesRequest,
} from '../../shared/index.js'
import type { CompanionTokenStore } from '../companion/token-store.js'
import { buildWorkThreads } from '../episodes/threads.js'
import { resolveResume } from '../resume/index.js'
import { phase1AdapterForBundle } from '../ingestion/index.js'
import { DeletionService } from '../retention/index.js'
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

  public async threads(
    request: { readonly limit?: number } = {},
  ): Promise<readonly WorkThread[]> {
    const episodes = await this.recent({ limit: 200 })
    return buildWorkThreads(episodes, {
      limit: boundedLimit(request.limit, 5, 100),
    })
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
