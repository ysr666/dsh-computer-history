import { describe, expect, it } from 'vitest'
import type { ComputerHistoryState } from '../../src/shared/index.js'
import { captureControlMode } from '../../src/client/settings-rows.js'
import { settingsViewMode } from '../../src/client/settings-view.js'

const baseState: ComputerHistoryState = {
  enabled: true,
  capture: 'running',
  accessibilityTrusted: true,
  observationRetentionHours: 24,
  episodeRetentionDays: 30,
  autoResume: false,
}

describe('client recording control state', () => {
  it('only exposes pause/resume for acknowledged controllable states', () => {
    expect(captureControlMode(baseState)).toBe('pause')
    expect(captureControlMode({ ...baseState, capture: 'paused' })).toBe('resume')
    for (const capture of ['stopped', 'degraded', 'permission-required'] as const) {
      expect(captureControlMode({ ...baseState, capture })).toBe('unavailable')
    }
    expect(captureControlMode({ ...baseState, enabled: false })).toBe('unavailable')
    expect(captureControlMode(undefined)).toBe('unavailable')
  })
})


describe('client settings page state', () => {
  it('never exposes stale controls while loading or after a failed reload', () => {
    expect(settingsViewMode({ status: 'idle' })).toBe('loading')
    expect(settingsViewMode({ status: 'loading' })).toBe('loading')
    expect(settingsViewMode({ status: 'error' })).toBe('error')
    expect(settingsViewMode({ status: 'ready' })).toBe('ready')
  })
})
