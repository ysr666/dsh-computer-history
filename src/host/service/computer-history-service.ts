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
  MinimisedSummaryPayload,
  PairingRotation,
  PairingState,
  SemanticOptIn,
  SemanticSummaryState,
  WorkThread,
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

  public threads(
    request: { readonly limit?: number } = {},
  ): Promise<readonly WorkThread[]> {
    return this.backend.threads(request)
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
  }): { readonly revoked: boolean; readonly purged: number } {
    return this.backend.revokeSemanticOptIn(request)
  }

  public pairing(): PairingState {
    return this.backend.pairing()
  }

  public rotatePairing(): PairingRotation {
    return this.backend.rotatePairing()
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
