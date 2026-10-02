import {
  COMPANION_BUNDLE_ID,
  type NativeObservation,
} from '../../shared/index.js'
import type { CompanionPayload } from './intake.js'

/**
 * The companion's payload as an observation the existing ingestion path can
 * take unchanged (ADR 0007): the provider marks the provenance that unlocks URL
 * resources, and the synthetic bundle id is one no real application carries.
 *
 * The URL is composed from the validated origin and path only. The intake has
 * already refused anything with a query or a fragment, and `resourceOf` strips
 * them again host-side.
 */
export function companionObservation(
  payload: CompanionPayload,
): NativeObservation {
  return {
    v: 1,
    type: 'observation',
    collectorSession: payload.browserSession,
    seq: payload.seq,
    observedAtMs: payload.observedAtMs,
    app: {
      pid: 0,
      bundleId: COMPANION_BUNDLE_ID,
      name: 'Browser companion',
    },
    window: {
      ...(payload.title ? { title: payload.title } : {}),
      url: `${payload.origin}${payload.path}`,
    },
    privacy: { secure: false, protected: false },
    source: { provider: 'companion', adapter: 'browser' },
  }
}
