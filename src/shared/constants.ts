import type { ObservationAdapter, SurfaceKind } from './observation.js'

export const PROTOCOL_VERSION = 1 as const
export const OBSERVATION_RETENTION_MS = 24 * 60 * 60 * 1000
export const EPISODE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const DETOUR_GRACE_MS = 90_000
export const IDLE_BOUNDARY_MS = 480_000
export const URL_ATTACH_WINDOW_MS = 90_000
export const MAX_PROTOCOL_LINE_BYTES = 64 * 1024
export const MAX_SUMMARY_BYTES = 1024

/**
 * The canonical Phase 1 adapter table.
 *
 * The native collector keeps the same table in Swift
 * (`native/macos/Sources/ComputerHistoryCollector/SupportedApps.swift`) because
 * it must resolve a bundle id before the Host sees anything. The two tables are
 * compared field by field in `tests/repository.spec.ts`, so adding an adapter
 * is one entry on each side and a drift fails the build instead of silently
 * downgrading an observation to the generic window surface.
 */
export interface Phase1AdapterDefinition {
  readonly id: ObservationAdapter
  readonly bundleIds: readonly string[]
  readonly surfaceKind: SurfaceKind
  /** Terminal windows carry cwd/command/session text, so titles are dropped. */
  readonly suppressesWindowTitle: boolean
  /** A terminal's document is its working directory, not a file. */
  readonly documentResourceKind: 'file' | 'directory'
}

export const PHASE1_ADAPTERS: readonly Phase1AdapterDefinition[] = [
  {
    id: 'vscode',
    bundleIds: [
      'com.microsoft.VSCode',
      'com.todesktop.230313mzl4w4u92',
    ],
    surfaceKind: 'editor',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
  },
  {
    id: 'terminal',
    bundleIds: [
      'com.apple.Terminal',
      'com.googlecode.iterm2',
    ],
    surfaceKind: 'terminal',
    suppressesWindowTitle: true,
    documentResourceKind: 'directory',
  },
  {
    id: 'preview',
    bundleIds: ['com.apple.Preview'],
    surfaceKind: 'document',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
  },
  {
    id: 'finder',
    bundleIds: ['com.apple.finder'],
    surfaceKind: 'window',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
  },
]

export const PHASE1_SUPPORTED_BUNDLE_IDS: readonly string[] =
  PHASE1_ADAPTERS.flatMap(adapter => [...adapter.bundleIds])

export function phase1AdapterDefinition(
  id: ObservationAdapter,
): Phase1AdapterDefinition | undefined {
  return PHASE1_ADAPTERS.find(adapter => adapter.id === id)
}
