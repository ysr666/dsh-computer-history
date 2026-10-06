import type {
  ComputerHistoryState,
  PolicySnapshot,
  SupportedApplicationInventory,
} from '../shared/index.js'
import { describeHealth, type HealthCode } from '../shared/health.js'

export type SetupStage =
  | 'choose-apps'
  | 'permission'
  | 'paused'
  | 'stopped'
  | 'degraded'
  | 'waiting'
  | 'complete'



/**
 * Narrow the cross-platform first-run preset to applications actually present
 * on this machine when the Host has a verified inventory. The synthetic
 * browser companion stays allowed because it is not an installed application
 * and cannot emit anything until its separately authenticated companion exists.
 *
 * If inventory is unavailable, preserve the existing preset rather than guess
 * from bundle-id spelling on an unverified platform.
 */
export function firstRunBundles(
  presetBundles: readonly string[],
  inventory: SupportedApplicationInventory | undefined,
): readonly string[] {
  if (!inventory?.available) return presetBundles
  const installed = new Set(
    inventory.applications.map(application => application.bundleId),
  )
  return presetBundles.filter(bundle =>
    bundle === 'companion.browser' || installed.has(bundle),
  )
}

export interface SetupStateInput {
  readonly state: ComputerHistoryState
  readonly policy: PolicySnapshot
  readonly hasAnyEpisode: boolean
  readonly newestEpisodeAtMs?: number
  readonly nowMs?: number
}

export interface AllowedAppsRecoveryInput {
  readonly isFirstRun: boolean
  readonly reason: string | undefined
  readonly hasPreset: boolean
}

/**
 * The empty-allow-list action belongs to an already-used installation. A pristine
 * first run already has the normal setup CTA, so rendering another recovery
 * button there would duplicate the same consent action.
 */
export function shouldOfferAllowedAppsRecovery(input: AllowedAppsRecoveryInput): boolean {
  return !input.isFirstRun
    && input.reason?.trim() === 'no-apps-allowed'
    && input.hasPreset
}

function allowedAppCount(policy: PolicySnapshot): number {
  return policy.rules.filter(rule =>
    rule.dimension === 'app' && rule.action === 'allow',
  ).length
}

/**
 * Product setup is complete because recording has proved itself, not because a
 * button was clicked. The pristine install first chooses allowed apps; after
 * that the existing health vocabulary determines the next user-visible step.
 */
export function setupStage(input: SetupStateInput): SetupStage {
  if (input.hasAnyEpisode) return 'complete'
  const allowRules = allowedAppCount(input.policy)
  if (allowRules === 0) return 'choose-apps'

  const health = describeHealth({
    capture: input.state.capture,
    accessibilityTrusted: input.state.accessibilityTrusted,
    allowRules,
    observationCount: 0,
    newestObservationAtMs: input.newestEpisodeAtMs,
    nowMs: input.nowMs ?? Date.now(),
  })
  const byHealth: Partial<Record<HealthCode, SetupStage>> = {
    permission: 'permission',
    paused: 'paused',
    stopped: 'stopped',
    degraded: 'degraded',
    idle: 'waiting',
    recording: 'waiting',
  }
  return byHealth[health.code] ?? 'waiting'
}
