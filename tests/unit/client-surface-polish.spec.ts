import { describe, expect, it } from 'vitest'
import { FOUNDATION_STYLES } from '../../src/client/styles/foundation.js'
import { CONTINUITY_STYLES } from '../../src/client/styles/continuity.js'
import { SETTINGS_STYLES } from '../../src/client/styles/settings.js'
import { TIMELINE_STYLES } from '../../src/client/styles/timeline.js'

describe('product surface polish', () => {
  it('keeps the first-run primary button legible and unwrapped', () => {
    expect(FOUNDATION_STYLES).toMatch(
      /\.ch-first-run-action \.ch-button\{[^}]*flex:0 0 auto;white-space:nowrap;min-width:92px/,
    )
    expect(FOUNDATION_STYLES).toMatch(
      /\.ch-first-run-action \.ch-button\.ch-continue-primary\{[^}]*color:var\(--dsw-alias-label-primary-inverted\)/,
    )
  })

  it('styles the three main product surfaces using DSH tokens', () => {
    expect(CONTINUITY_STYLES).toContain('var(--dsw-alias-brand-primary)')
    expect(TIMELINE_STYLES).toContain('var(--dsw-alias-bg-base)')
    expect(SETTINGS_STYLES).toContain('var(--dsw-alias-border-l1)')
  })
})
