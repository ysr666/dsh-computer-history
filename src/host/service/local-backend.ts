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
    return this.deletion.delete(request, this.now())
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

  public async replacePolicy(
    update: PolicyUpdate,
  ): Promise<PolicySnapshot> {
    return this.policies.replace(
      update.mode,
      update.rules,
      this.now(),
    )
  }
}
