import { describe, expect, it } from 'vitest'
import { describeHealth } from '../../src/shared/health.js'

const base = {
  capture: 'running' as const,
  accessibilityTrusted: true,
  allowRules: 2,
  observationCount: 5,
  newestObservationAtMs: 1_000_000,
  nowMs: 1_000_000 + 3 * 60_000,
}

describe('what the panel says about itself', () => {
  it('names the state that blocks everything, in the order that matters', () => {
    expect(describeHealth({ ...base, capture: 'stopped' }).level).toBe('blocked')
    expect(describeHealth({ ...base, capture: 'stopped' }).text)
      .toContain('Collection is stopped')
    expect(describeHealth({ ...base, accessibilityTrusted: false }).text)
      .toContain('Accessibility')
    // Nothing allowed outranks "nothing recorded yet": it is the actionable one.
    expect(describeHealth({ ...base, allowRules: 0, observationCount: 0 }).text)
      .toContain('Nothing is allowed yet')
    expect(describeHealth({ ...base, allowRules: 0, observationCount: 0 }).level)
      .toBe('blocked')
  })

  it('names a paused collection as its own state', () => {
    const paused = describeHealth({ ...base, capture: 'paused' })
    expect(paused.level).toBe('blocked')
    expect(paused.text).toContain('paused')
    // `permission-required` from the collector is the same fact as a missing grant.
    expect(describeHealth({ ...base, capture: 'permission-required' }).text)
      .toContain('Accessibility')
  })

  it('distinguishes an idle install from a broken one', () => {
    const idle = describeHealth({ ...base, observationCount: 0 })
    expect(idle.level).toBe('idle')
    expect(idle.text).toContain('ready')
  })

  it('reports the newest observation age when it is recording', () => {
    const line = describeHealth(base)
    expect(line.level).toBe('recording')
    expect(line.text).toContain('newest 3 minute(s) ago')
    // A store with observations but no timestamp still reads sensibly.
    expect(describeHealth({ ...base, newestObservationAtMs: undefined }).text)
      .toContain('5 observations')
  })
})
