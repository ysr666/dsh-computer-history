import type { SurfaceKind } from './observation.js'

/**
 * What a summary provider may see (ADR 0004 §4), and what the panel shows in
 * the payload preview. It is shape without identity: no paths, titles or
 * addresses.
 */
export interface MinimisedSummaryPayload {
  readonly appBundleIds: readonly string[]
  readonly surfaceKinds: readonly SurfaceKind[]
  readonly resourceKinds: readonly string[]
  readonly fileExtensions: readonly string[]
  readonly observationCount: number
  readonly startHourOfDay: number
  readonly durationMinutes: number
  readonly workspaceRootName?: string
  readonly hasThread: boolean
}

/** A recorded per-scope permission to summarise with a model (ADR 0004 §4). */
export interface SemanticOptIn {
  readonly scopeKey: string
  readonly providerKind: 'local' | 'remote'
  readonly model?: string
  readonly createdAtMs: number
}

export interface SemanticSummaryState {
  /** What a fresh episode gets today: deterministic text unless a scope opts in. */
  readonly active: 'deterministic'
  readonly localProviderConfigured: boolean
  readonly scopes: readonly SemanticOptIn[]
}
