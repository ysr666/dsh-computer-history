import {
  Service,
  type Context,
} from '@deepseek-ai/cordis'
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
  implements ComputerHistoryServiceContract {
  private readonly backend: ComputerHistoryServiceContract

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

  public getState(): ComputerHistoryState {
    return this.backend.getState()
  }

  public listPolicyRules(): readonly PolicyRule[] {
    return this.backend.listPolicyRules()
  }

  public replacePolicy(
    update: PolicyUpdate,
  ): Promise<PolicySnapshot> {
    return this.backend.replacePolicy(update)
  }
}
