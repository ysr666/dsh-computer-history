import { describe, expect, it } from 'vitest'
import type {
  ComputerHistoryState,
  PolicySnapshot,
} from '../../src/shared/index.js'
import { firstRunBundles, setupStage } from '../../src/client/setup-state.js'

const state: ComputerHistoryState = {
  enabled: true,
  capture: 'running',
  accessibilityTrusted: true,
  observationRetentionHours: 24,
  episodeRetentionDays: 30,
  autoResume: false,
}

function policy(allowed = false): PolicySnapshot {
  return {
    revision: 1,
    mode: 'include-only',
    rules: allowed
      ? [{
          id: 'rule:1' as never,
          dimension: 'app',
          action: 'allow',
          matcher: 'exact',
          pattern: 'com.example.Editor',
          builtIn: false,
          createdAtMs: 1,
          updatedAtMs: 1,
        }]
      : [],
    updatedAtMs: 1,
  }
}

describe('first-run setup state', () => {

  it('narrows the cross-platform preset only when verified inventory is available', () => {
    const preset = [
      'com.microsoft.VSCode',
      'com.apple.Terminal',
      'WindowsTerminal.exe',
      'code.desktop',
      'companion.browser',
    ]
    expect(firstRunBundles(preset, undefined)).toEqual(preset)
    expect(firstRunBundles(preset, {
      available: true,
      applications: [{
        bundleId: 'com.microsoft.VSCode',
        name: 'Visual Studio Code',
        surfaceKind: 'editor',
      }],
    })).toEqual([
      'com.microsoft.VSCode',
      'companion.browser',
    ])
    expect(firstRunBundles(preset, {
      available: true,
      applications: [],
    })).toEqual(['companion.browser'])
  })

  it('does not call setup complete merely because app rules were written', () => {
    expect(setupStage({ state, policy: policy(false), hasAnyEpisode: false }))
      .toBe('choose-apps')
    expect(setupStage({
      state: { ...state, accessibilityTrusted: false, capture: 'permission-required' },
      policy: policy(true),
      hasAnyEpisode: false,
    })).toBe('permission')
    expect(setupStage({ state, policy: policy(true), hasAnyEpisode: false }))
      .toBe('waiting')
  })

  it('names paused and degraded capture instead of pretending the timeline is ready', () => {
    expect(setupStage({
      state: { ...state, capture: 'paused' },
      policy: policy(true),
      hasAnyEpisode: false,
    })).toBe('paused')
    expect(setupStage({
      state: { ...state, capture: 'degraded' },
      policy: policy(true),
      hasAnyEpisode: false,
    })).toBe('degraded')
  })

  it('finishes setup only after stored history proves the path has worked', () => {
    expect(setupStage({
      state: { ...state, capture: 'paused', accessibilityTrusted: false },
      policy: policy(true),
      hasAnyEpisode: true,
    })).toBe('complete')
  })
})
