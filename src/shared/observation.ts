import type { CollectorSessionId, ObservationId } from './ids.js'
import type { ResourceIdentity } from './resource.js'
import type { WorkspaceRef } from './workspace.js'

export type SurfaceKind =
  | 'window'
  | 'editor'
  | 'terminal'
  | 'browser'
  | 'document'
  | 'unknown'

export type ActivityEventKind =
  | 'save'
  | 'verify-build-success'
  | 'verify-build-failure'
  | 'verify-test-success'
  | 'verify-test-failure'
  | 'verify-other-success'
  | 'verify-other-failure'

export type ObservationAdapter =
  | 'generic'
  | 'vscode'
  | 'xcode'
  | 'word'
  | 'wps'
  | 'jetbrains'
  | 'notes'
  | 'obsidian'
  | 'browser'
  | 'terminal'
  | 'preview'
  | 'finder'
  | 'notepad'

/** Who produced the observation. */
export type ObservationProvider =
  | 'macos-ax'
  | 'windows-uia'
  /** The Linux Accessibility path (AT-SPI over D-Bus). Added 2026-10-05: the collector sends it, the store
   * refused it, and the row that found this is the same row that found the missing `linux` platform. */
  | 'at-spi'
  | 'companion'

export interface ActivityObservation {
  readonly id?: ObservationId
  readonly collectorSessionId: CollectorSessionId
  readonly seq: number
  readonly observedAtMs: number

  readonly app: {
    readonly pid: number
    readonly bundleId: string
    readonly displayName?: string
  }

  readonly surface: {
    readonly kind: SurfaceKind
    readonly title?: string
  }

  readonly element?: {
    readonly role?: string
    readonly subrole?: string
    readonly identifier?: string
    readonly title?: string
  }

  readonly resource?: ResourceIdentity
  readonly workspace: WorkspaceRef

  readonly activity: {
    readonly idleSeconds?: number
    /** Trusted companion metadata only; native collectors cannot assert this. */
    readonly event?: ActivityEventKind
  }

  readonly privacy: {
    readonly secure: boolean
    readonly protected: boolean
    readonly reason?: string
  }

  readonly source: {
    readonly provider: ObservationProvider
    readonly adapter: ObservationAdapter
  }

  readonly policyRevision: number
  readonly expiresAtMs: number
}
