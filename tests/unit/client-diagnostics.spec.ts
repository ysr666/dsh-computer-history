import { describe, expect, it } from 'vitest'
import { buildDiagnosticReport } from '../../src/client/diagnostics.js'
import type { ComputerHistoryState } from '../../src/shared/index.js'

const state: ComputerHistoryState = {
  enabled: true,
  capture: 'running',
  accessibilityTrusted: true,
  reason: 'diagnostic-reason',
  refusedByReason: { protected: 2 },
  release: {
    version: '0.1.0-dev.0',
    loadedFrom: '/Users/private/profile/node_modules/dsh-computer-history',
    builtAtMs: 123,
    stale: {
      profile: '/Users/private/.dsh/profiles/desktop',
      artifact: '/Users/private/build.tgz',
      artifactAtMs: 100,
      updateCommand: 'secret-looking-update-command',
    },
  },
  companion: {
    listening: true,
    port: 19388,
    paired: true,
    editorPaired: true,
    browserLastSeenAtMs: 20,
    editorLastSeenAtMs: 30,
  },
  observationRetentionHours: 24,
  episodeRetentionDays: 30,
  autoResume: false,
  collector: { version: '1.2.3', arch: 'arm64' },
}

describe('client diagnostic report', () => {
  it('contains runtime health but excludes paths, ports, commands and credentials', () => {
    const report = buildDiagnosticReport(state, 999)
    expect(report).toMatchObject({
      format: 'dsh-computer-history-diagnostics-v1',
      generatedAtMs: 999,
      plugin: { version: '0.1.0-dev.0', builtAtMs: 123, stale: true },
      capture: { enabled: true, state: 'running', accessibilityTrusted: true },
      retention: { observationHours: 24, episodeDays: 30 },
      collector: { version: '1.2.3', arch: 'arm64' },
      companions: {
        browser: { listening: true, paired: true, lastSeenAtMs: 20 },
        editor: { paired: true, lastSeenAtMs: 30 },
      },
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('/Users/private')
    expect(serialized).not.toContain('19388')
    expect(serialized).not.toContain('secret-looking-update-command')
    expect(serialized).not.toContain('token')
  })
})
