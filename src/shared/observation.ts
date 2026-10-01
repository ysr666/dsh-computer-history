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

export type ObservationAdapter =
  | 'generic'
  | 'vscode'
  | 'terminal'
  | 'preview'
  | 'finder'

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
  }

  readonly privacy: {
    readonly secure: boolean
    readonly protected: boolean
    readonly reason?: string
  }

  readonly source: {
    readonly provider: 'macos-ax'
    readonly adapter: ObservationAdapter
  }

  readonly policyRevision: number
  readonly expiresAtMs: number
}
