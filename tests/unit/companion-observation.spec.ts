import { describe, expect, it } from 'vitest'
import {
  COMPANION_BUNDLE_ID,
  PHASE1_ADAPTERS,
} from '../../src/shared/index.js'
import { companionObservation } from '../../src/host/companion/observation.js'

describe('companion observation', () => {
  it('carries companion provenance and the synthetic bundle id', () => {
    const observation = companionObservation({
      origin: 'https://example.test',
      path: '/docs/guide',
      title: 'Example page',
      incognito: false,
      browserSession: 'session-1',
      seq: 7,
      observedAtMs: 12_345,
    })

    expect(observation.source).toEqual({
      provider: 'companion',
      adapter: 'browser',
    })
    expect(observation.app.bundleId).toBe(COMPANION_BUNDLE_ID)
    expect(observation.window?.url).toBe('https://example.test/docs/guide')
    expect(observation.window?.title).toBe('Example page')
    expect(observation.collectorSession).toBe('session-1')
    expect(observation.seq).toBe(7)
    // Nothing about the page is read, so nothing else can be carried.
    expect(observation.element).toBeUndefined()
    expect(observation.privacy.secure).toBe(false)
  })

  it('keeps the synthetic bundle id in the adapter table', () => {
    // The constant and the table must not drift: the constant is what the
    // companion reports, the table is what the Host resolves.
    const browser = PHASE1_ADAPTERS.find(entry => entry.id === 'browser')
    expect(browser?.bundleIds).toContain(COMPANION_BUNDLE_ID)
  })
})
