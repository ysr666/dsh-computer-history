import type {
  ComputerHistoryState,
} from '../../shared/index.js'

export interface CaptureController {
  pause(): Promise<void>
  resume(): Promise<void>
  getState(): Pick<
    ComputerHistoryState,
    'enabled' | 'capture' | 'accessibilityTrusted' | 'collector'
  >
}

export interface LocalBackendConfig {
  readonly observationRetentionHours: number
  readonly episodeRetentionDays: number
  readonly autoResume: boolean
  readonly now?: () => number
}
