import type {
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
  return Math.max(
    1,
    Math.min(max, Math.trunc(value ?? fallback)),
  )
}

export class LocalComputerHistoryBackend
implements ComputerHistoryServiceContract {
  private readonly now: () => number

  public constructor(
    private readonly episodes: EpisodeStore,
    private readonly policies: PolicyStore,
    private readonly deletion: DeletionService,
    private readonly capture: CaptureController,
    private readonly config: LocalBackendConfig,
  ) {
    this.now = config.now ?? Date.now
  }

  public async recent(
    request: RecentEpisodesRequest = {},
    _signal?: AbortSignal,
  ): Promise<readonly EpisodeSummary[]> {
    return this.episodes.listRecent({
      ...(request.sinceMs === undefined
        ? {}
        : { sinceMs: request.sinceMs }),
      ...(request.workspaceId
        ? { workspaceId: request.workspaceId }
        : {}),
      limit: boundedLimit(request.limit, 5, 20),
    })
  }

  public async search(
    request: SearchEpisodesRequest,
    _signal?: AbortSignal,
  ): Promise<readonly EpisodeSummary[]> {
    const query = request.query.trim()
    if (query.length < 1 || query.length > 500) {
      throw new Error('history search query must contain 1..500 characters')
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
      limit: boundedLimit(request.limit, 5, 20),
    })
  }

  public async getEpisode(
    id: EpisodeId,
    _signal?: AbortSignal,
  ): Promise<EpisodeDetail | undefined> {
    return this.episodes.get(id)
  }

  public async resolveResume(
    request: ResumeRequest,
    _signal?: AbortSignal,
  ): Promise<ResumeResolution> {
    return resolveResume(
      this.episodes.listRecent({ limit: 500 }),
      request,
    )
  }

  public async delete(
    request: DeleteHistoryRequest,
    _signal?: AbortSignal,
  ): Promise<DeleteHistoryResult> {
    try {
      return this.deletion.delete(
        request,
        this.now(),
      )
    } finally {
      await this.config.onHistoryChanged?.()
    }
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

  public listPolicyRules(): readonly PolicyRule[] {
    return this.policies.get().rules
  }

  public getPolicy(): PolicySnapshot {
    return this.policies.get()
  }

  public async replacePolicy(
    update: PolicyUpdate,
  ): Promise<PolicySnapshot> {
    const releasePolicyLease =
      await this.config.acquirePolicyChangeLease?.()
        ?? (async () => {})

    try {
      if (update.mode !== 'include-only') {
        throw new Error(
          'Phase 1 requires include-only capture policy',
        )
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
