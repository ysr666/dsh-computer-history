import { describe, expect, it } from 'vitest'
import type { ComputerHistoryState } from '../../src/shared/index.js'
import {
  captureControlMode,
  companionUiStatus,
  editorCompanionAwaitingFirstContact,
  editorCompanionConnected,
  deleteHistoryRequest,
} from '../../src/client/settings-rows.js'
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

describe('client companion presentation', () => {
  it('does not confuse a stored token with an extension that has actually connected', () => {
    expect(companionUiStatus(undefined)).toBe('unavailable')
    expect(companionUiStatus({ listening: false, paired: false })).toBe('unavailable')
    expect(companionUiStatus({ listening: true, paired: false, port: 19388 })).toBe('setup')
    expect(companionUiStatus({ listening: true, paired: true, port: 19388 })).toBe('configured')
    expect(companionUiStatus({
      listening: true,
      paired: true,
      port: 19388,
      browserLastSeenAtMs: 100,
    })).toBe('connected')
    expect(companionUiStatus({
      listening: true,
      paired: true,
      port: 19388,
      editorLastSeenAtMs: 100,
    })).toBe('configured')
  })
})

describe('client editor companion presentation', () => {

  it('does not call an editor companion connected after the VS Code extension is removed', () => {
    expect(editorCompanionConnected(undefined, 100)).toBe(false)
    expect(editorCompanionConnected({ available: true, installed: false }, 100)).toBe(false)
    expect(editorCompanionConnected({ available: true, installed: true }, undefined)).toBe(false)
    expect(editorCompanionConnected({ available: true, installed: true }, 100)).toBe(true)
  })

  it('polls only while an installed paired editor is waiting for first contact', () => {
    const installed = { available: true, installed: true } as const
    expect(editorCompanionAwaitingFirstContact(undefined, true, undefined)).toBe(false)
    expect(editorCompanionAwaitingFirstContact({ available: true, installed: false }, true, undefined)).toBe(false)
    expect(editorCompanionAwaitingFirstContact(installed, false, undefined)).toBe(false)
    expect(editorCompanionAwaitingFirstContact(installed, true, undefined)).toBe(true)
    expect(editorCompanionAwaitingFirstContact(installed, true, 100)).toBe(false)
  })
})

describe('client history deletion presets', () => {
  it('maps recent-history choices onto the existing time-range contract', () => {
    const now = 1_000_000_000
    expect(deleteHistoryRequest('ten-minutes', now)).toEqual({
      scope: { kind: 'time-range', startMs: now - 600_000, endMs: now },
    })
    expect(deleteHistoryRequest('hour', now)).toEqual({
      scope: { kind: 'time-range', startMs: now - 3_600_000, endMs: now },
    })
    expect(deleteHistoryRequest('day', now)).toEqual({
      scope: { kind: 'time-range', startMs: now - 86_400_000, endMs: now },
    })
    expect(deleteHistoryRequest('all', now)).toEqual({ scope: { kind: 'all' } })
  })
})

