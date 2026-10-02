import type { ObservationId } from '../../shared/index.js'
import type { MinimisedSummaryPayload } from './minimise.js'

export type SummaryProviderKind = 'deterministic' | 'local' | 'remote'

export interface SummaryRequest {
  readonly scope: SummaryScope
  readonly payload: MinimisedSummaryPayload
  readonly citations: readonly ObservationId[]
}

export type SummaryScope =
  | { readonly kind: 'workspace'; readonly id: string }
  | { readonly kind: 'app'; readonly bundleId: string }

export interface SummaryProvider {
  readonly kind: SummaryProviderKind
  /** The endpoint this provider talks to, for the panel to show. */
  readonly endpoint?: string
  summarise(request: SummaryRequest): Promise<string>
}

export class SummaryProviderError extends Error {}

/** Only these hosts may be contacted, whatever a caller passes in. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * Reject any endpoint that is not loopback. Every provider that speaks HTTP
 * calls this before it sends anything, which is what makes "nothing leaves the
 * device" a property of the code rather than a promise in a document.
 */
export function assertLoopbackEndpoint(endpoint: string): URL {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new SummaryProviderError(`not a valid endpoint: ${endpoint}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SummaryProviderError(`unsupported endpoint protocol: ${url.protocol}`)
  }
  // `URL.hostname` keeps the brackets around an IPv6 literal, so `[::1]` would
  // otherwise be refused as if it were a remote host.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new SummaryProviderError(
      `summary endpoints must be loopback, got ${host}`,
    )
  }
  return url
}

export function scopeKey(scope: SummaryScope): string {
  return scope.kind === 'workspace'
    ? `workspace:${scope.id}`
    : `app:${scope.bundleId}`
}
