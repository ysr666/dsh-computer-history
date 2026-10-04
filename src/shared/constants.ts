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
  /**
   * `window-only` means the application's Accessibility bridge exposes no
   * queryable focused element, so window metadata is recorded without element
   * fields (ADR 0006). A readable secure field still withholds the
   * observation.
   */
  readonly focusedElementPolicy: 'require' | 'window-only'
}

export const PHASE1_ADAPTERS: readonly Phase1AdapterDefinition[] = [
  {
    id: 'vscode',
    bundleIds: [
      'com.microsoft.VSCode',
      'com.todesktop.230313mzl4w4u92',
      // win32: the executable name Windows reports for the foreground window. Measured 2026-10-04 for
      // Windows Terminal and Explorer; `Code.exe` is the expected shape for a VS Code user install.
      'Code.exe',
    ],
    surfaceKind: 'editor',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
  {
    id: 'xcode',
    bundleIds: ['com.apple.dt.Xcode'],
    surfaceKind: 'editor',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
  {
    id: 'word',
    bundleIds: ['com.microsoft.Word'],
    surfaceKind: 'document',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
  {
    id: 'wps',
    // Measured 2026-10-02: WPS reports no kAXDocument for its window, so the
    // surface stays a window and observations carry titles only.
    bundleIds: ['com.kingsoft.wpsoffice.mac'],
    surfaceKind: 'window',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
  {
    id: 'jetbrains',
    // IntelliJ-platform applications. Measured on Android Studio 2026-10-02:
    // the focused element reference rejects every read (-25202) while the
    // window reads normally, which is why this adapter is window-only under
    // ADR 0006. The other bundle ids share the platform and were not installed
    // on the validation machine.
    bundleIds: [
      'com.google.android.studio',
      'com.jetbrains.intellij',
      'com.jetbrains.intellij.ce',
      'com.jetbrains.pycharm',
      'com.jetbrains.pycharm.ce',
      'com.jetbrains.goland',
      'com.jetbrains.webstorm',
      'com.jetbrains.clion',
      'com.jetbrains.rustrover',
      'com.jetbrains.datagrip',
    ],
    surfaceKind: 'editor',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'window-only',
  },
  {
    id: 'notes',
    // Measured 2026-10-02: readable focused element, no window document, no
    // kAXURL, so a note is a title-only surface.
    bundleIds: ['com.apple.Notes'],
    surfaceKind: 'window',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
  {
    id: 'obsidian',
    // Measured 2026-10-02: Chromium shape (focused-element attribute answers
    // -25212), readable window title, empty document on the vault picker.
    bundleIds: ['md.obsidian'],
    surfaceKind: 'editor',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
  {
    id: 'browser',
    // The companion's synthetic source. No real application carries this bundle
    // id, so the Accessibility path can never produce it; a companion
    // observation is the only way this adapter is used (ADR 0007).
    bundleIds: ['companion.browser'],
    surfaceKind: 'browser',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
  {
    id: 'terminal',
    bundleIds: [
      'com.apple.Terminal',
      'com.googlecode.iterm2',
      // win32: measured 2026-10-04 - the Windows Terminal window reports its executable name, not the
      // packaged AppUserModelID (Microsoft.WindowsTerminal_8wekyb3d8bbwe!App) the Start menu publishes.
      'WindowsTerminal.exe',
    ],
    surfaceKind: 'terminal',
    suppressesWindowTitle: true,
    documentResourceKind: 'directory',
    focusedElementPolicy: 'require',
  },
  {
    id: 'preview',
    bundleIds: ['com.apple.Preview'],
    surfaceKind: 'document',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
  {
    id: 'finder',
    bundleIds: [
      'com.apple.finder',
      // win32: Explorer has no AppUserModelID, so its executable name is the identity
      // (expected mapping, see the vscode note).
      'explorer.exe',
    ],
    surfaceKind: 'window',
    suppressesWindowTitle: false,
    documentResourceKind: 'file',
    focusedElementPolicy: 'require',
  },
]

/**
 * The bundle id the browser companion reports. It belongs to the synthetic
 * `browser` adapter and no real application carries it, so an Accessibility
 * observation can never claim companion provenance.
 */
export const COMPANION_BUNDLE_ID = 'companion.browser'

export const PHASE1_SUPPORTED_BUNDLE_IDS: readonly string[] =
  PHASE1_ADAPTERS.flatMap(adapter => [...adapter.bundleIds])

export function phase1AdapterDefinition(
  id: ObservationAdapter,
): Phase1AdapterDefinition | undefined {
  return PHASE1_ADAPTERS.find(adapter => adapter.id === id)
}
