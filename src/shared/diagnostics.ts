import type { ComputerHistoryState } from './api.js'

export interface ComputerHistoryDiagnosticReport {
  readonly format: 'dsh-computer-history-diagnostics-v1'
  readonly generatedAtMs: number
  readonly plugin: {
    readonly version?: string
    readonly builtAtMs?: number
    readonly stale: boolean
  }
  readonly capture: {
    readonly enabled: boolean
    readonly state: ComputerHistoryState['capture']
    readonly accessibilityTrusted: boolean
    readonly reason?: string
  }
  readonly retention: {
    readonly observationHours: number
    readonly episodeDays: number
    readonly maintenance: 'ok' | 'failed' | 'unknown'
    readonly lastMaintenanceFailureAtMs?: number
  }
  readonly collector?: {
    readonly version: string
    readonly arch: string
  }
  readonly companions: {
    readonly browser: {
      readonly listening: boolean
      readonly paired: boolean
      readonly lastSeenAtMs?: number
      readonly reason?: string
    }
    readonly editor: {
      readonly paired: boolean
      readonly lastSeenAtMs?: number
    }
  }
  readonly refusedByReason: Readonly<Record<string, number>>
}

/**
 * Support-safe runtime facts only. Deliberately excludes history, resources,
 * paths, ports, credentials, commands and any content-bearing metadata.
 */
export function buildDiagnosticReport(
  state: ComputerHistoryState,
  nowMs = Date.now(),
): ComputerHistoryDiagnosticReport {
  const companion = state.companion
  return {
    format: 'dsh-computer-history-diagnostics-v1',
    generatedAtMs: nowMs,
    plugin: {
      ...(state.release?.version ? { version: state.release.version } : {}),
      ...(state.release?.builtAtMs === undefined
        ? {}
        : { builtAtMs: state.release.builtAtMs }),
      stale: state.release?.stale !== undefined,
    },
    capture: {
      enabled: state.enabled,
      state: state.capture,
      accessibilityTrusted: state.accessibilityTrusted,
      ...(state.reason ? { reason: state.reason } : {}),
    },
    retention: {
      observationHours: state.observationRetentionHours,
      episodeDays: state.episodeRetentionDays,
      maintenance: state.maintenance?.retention ?? 'unknown',
      ...(state.maintenance?.lastFailureAtMs === undefined
        ? {}
        : { lastMaintenanceFailureAtMs: state.maintenance.lastFailureAtMs }),
    },
    ...(state.collector ? { collector: state.collector } : {}),
    companions: {
      browser: {
        listening: companion?.listening ?? false,
        paired: companion?.paired ?? false,
        ...(companion?.browserLastSeenAtMs === undefined
          ? {}
          : { lastSeenAtMs: companion.browserLastSeenAtMs }),
        ...(companion?.reason ? { reason: companion.reason } : {}),
      },
      editor: {
        paired: companion?.editorPaired ?? false,
        ...(companion?.editorLastSeenAtMs === undefined
          ? {}
          : { lastSeenAtMs: companion.editorLastSeenAtMs }),
      },
    },
    refusedByReason: { ...state.refusedByReason },
  }
}
