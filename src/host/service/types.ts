import type {
  ComputerHistoryState,
} from '../../shared/index.js'

export interface CaptureController {
  pause(): Promise<void>
  resume(): Promise<void>
  recover(): Promise<void>
  getState(): Pick<
    ComputerHistoryState,
    | 'enabled'
    | 'capture'
    | 'accessibilityTrusted'
    | 'reason'
    | 'collector'
    | 'companion'
  >
  /** Present on the real controller; used by the pairing route. */
  getCompanionState?(): NonNullable<ComputerHistoryState['companion']>
}

export interface LocalBackendConfig {
  /** Providers the Host can actually execute. Omitted means the execution seam is unavailable. */
  readonly semanticProviders?: {
    readonly local?: { readonly model: string }
    readonly remote?: { readonly model: string }
  }
  readonly observationRetentionHours: number
  readonly episodeRetentionDays: number
  readonly autoResume: boolean
  readonly now?: () => number
  readonly acquirePolicyChangeLease?: () => Promise<() => Promise<void>>
  readonly onPolicyChanged?: (policy: import('../../shared/index.js').PolicySnapshot) => void | Promise<void>
  readonly onHistoryChanged?: () => void | Promise<void>
}
