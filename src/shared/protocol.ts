export type CollectorCapability =
  | 'app-focus'
  | 'window-metadata'
  | 'resource-uri'
  | 'secure-field-detection'

/**
 * The platforms this product ships a collector for. `linux` was missing until 2026-10-05, in the type and in
 * the parser that reads the same vocabulary - a Linux collector's `hello` was refused as a "platform
 * mismatch" even though the protocol, the adapter fixture and the validation file all named Linux.
 */
export type CollectorPlatform = 'darwin' | 'win32' | 'linux'

export interface CollectorHello {
  readonly v: 1
  readonly type: 'hello'
  readonly collectorSession: string
  readonly collectorVersion: string
  readonly platform: CollectorPlatform
  readonly arch: 'arm64' | 'x64' | 'x86'
  readonly capabilities: readonly CollectorCapability[]
}

import type { ObservationProvider } from './observation.js'

export interface NativeObservation {
  readonly v: 1
  readonly type: 'observation'
  readonly collectorSession: string
  readonly seq: number
  readonly observedAtMs: number
  readonly app: {
    readonly pid: number
    readonly bundleId: string
    readonly name?: string
  }
  readonly window?: {
    readonly title?: string
    readonly document?: string
    readonly url?: string
  }
  readonly element?: {
    readonly role?: string
    readonly subrole?: string
    readonly identifier?: string
  }
  readonly activity?: {
    readonly idleSeconds?: number
  }
  readonly privacy: {
    readonly secure: boolean
    readonly protected: boolean
    readonly reason?: string
  }
  /**
   * A workspace a **paired companion** vouched for (ADR 0009). The Accessibility
   * path cannot make this claim - it can only guess from a document path - so
   * ingestion honours this field only when `source.provider === 'companion'`.
   */
  readonly workspace?: {
    readonly root: string
    readonly title?: string
  }
  readonly source: {
    readonly adapter: string
    /**
     * Where the observation came from. Native collectors may declare `macos-ax`, `windows-uia`, or `at-spi`;
     * the Host preserves that provenance. `companion` is never accepted from collector wire input - the paired
     * companion intake sets it only on messages it constructs locally (ADR 0007/0009). Older collectors that
     * omit the field retain the historical macOS fallback during normalization for wire compatibility.
     */
    readonly provider?: ObservationProvider
  }
}

export interface CollectorState {
  readonly v: 1
  readonly type: 'state'
  readonly state:
    | 'running'
    | 'paused'
    | 'permission-required'
    | 'degraded'
  readonly accessibilityTrusted: boolean
  readonly reason?: string
}

export interface CollectorConfigured {
  readonly v: 1
  readonly type: 'configured'
  readonly revision: number
}

export interface CollectorDiagnostic {
  readonly v: 1
  readonly type: 'diagnostic'
  readonly level: 'debug' | 'info' | 'warn'
  readonly code: string
  readonly message: string
}

export interface CollectorFatal {
  readonly v: 1
  readonly type: 'fatal'
  readonly code: string
  readonly message: string
}

export type CollectorToHost =
  | CollectorHello
  | NativeObservation
  | CollectorState
  | CollectorConfigured
  | CollectorDiagnostic
  | CollectorFatal

export interface ConfigureMessage {
  readonly v: 1
  readonly type: 'configure'
  readonly revision: number
  readonly policy: {
    readonly mode: 'include-only'
    readonly allowedBundleIds: readonly string[]
    readonly blockedBundleIds: readonly string[]
    readonly protectedBundleIds: readonly string[]
    readonly protectedPathPatterns: readonly string[]
  }
}

export interface PauseMessage {
  readonly v: 1
  readonly type: 'pause'
}

export interface ResumeMessage {
  readonly v: 1
  readonly type: 'resume'
}

export interface ShutdownMessage {
  readonly v: 1
  readonly type: 'shutdown'
  readonly reason:
    | 'plugin-dispose'
    | 'host-shutdown'
    | 'protocol-error'
}

export type HostToCollector =
  | ConfigureMessage
  | PauseMessage
  | ResumeMessage
  | ShutdownMessage
