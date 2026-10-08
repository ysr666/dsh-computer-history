import { describe, expect, it } from 'vitest'
import { FOUNDATION_STYLES } from '../../src/client/styles/foundation.js'
import { CONTINUITY_STYLES } from '../../src/client/styles/continuity.js'
import { SETTINGS_STYLES } from '../../src/client/styles/settings.js'
import { TIMELINE_STYLES } from '../../src/client/styles/timeline.js'
import { RESPONSIVE_STYLES } from '../../src/client/styles/responsive.js'

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
  it('stacks Settings row controls below copy when the Host slot is narrow', () => {
    expect(RESPONSIVE_STYLES).toContain('@media(max-width:480px)')
    expect(RESPONSIVE_STYLES).toContain('grid-template-columns:24px minmax(0,1fr)')
    expect(RESPONSIVE_STYLES).toContain('.ch-settings-summary>:last-child:not(.ch-settings-copy)')
    expect(RESPONSIVE_STYLES).toContain('overflow-wrap:anywhere')
  })

  it('keeps the Settings read-error card inside a narrow Host slot', () => {
    expect(RESPONSIVE_STYLES).toContain('.ch-settings-state{')
    expect(RESPONSIVE_STYLES).toContain('display:flex;flex-direction:column;align-items:flex-start')
    expect(RESPONSIVE_STYLES).toContain('.ch-settings-state .ch-state-copy{')
    expect(RESPONSIVE_STYLES).toContain('.ch-settings-state>.ch-button{')
  })

})
