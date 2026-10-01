import { describe, expect, it } from 'vitest'
import {
  CollectorSessionId,
  EpisodeId,
  EPISODE_RETENTION_MS,
  MAX_PROTOCOL_LINE_BYTES,
  OBSERVATION_RETENTION_MS,
  PolicyRuleId,
  type CollectorToHost,
  type DeleteHistoryScope,
  type HostToCollector,
  type ResumeResolution,
} from '../../src/shared/index.js'

describe('shared contracts', () => {
  it('keeps the Phase 1 retention defaults explicit', () => {
    expect(OBSERVATION_RETENTION_MS).toBe(24 * 60 * 60 * 1000)
    expect(EPISODE_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('keeps protocol lines bounded at 64 KiB', () => {
    expect(MAX_PROTOCOL_LINE_BYTES).toBe(64 * 1024)
  })

  it('creates branded identifiers without runtime mutation', () => {
    expect(EpisodeId('episode-1')).toBe('episode-1')
    expect(PolicyRuleId('policy-1')).toBe('policy-1')
    expect(CollectorSessionId('session-1')).toBe('session-1')
  })

  it('models collector-to-host messages as a versioned discriminated union', () => {
    const message = {
      v: 1,
      type: 'hello',
      collectorSession: 'session-1',
      collectorVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      capabilities: ['app-focus', 'window-metadata'],
    } satisfies CollectorToHost

    expect(message.type).toBe('hello')
    expect(message.v).toBe(1)
  })

  it('models host-to-collector control messages without DSH semantics', () => {
    const message = {
      v: 1,
      type: 'configure',
      revision: 3,
      policy: {
        mode: 'include-only',
        allowedBundleIds: ['com.microsoft.VSCode'],
        blockedBundleIds: [],
        protectedBundleIds: ['com.apple.keychainaccess'],
        protectedPathPatterns: ['**/.env'],
      },
    } satisfies HostToCollector

    expect(message.type).toBe('configure')
    expect(message.revision).toBe(3)
  })

  it('treats ambiguity as a first-class resume result', () => {
    const resolution = {
      status: 'ambiguous',
      candidates: [],
      reason: 'same resource basename exists in multiple workspaces',
    } satisfies ResumeResolution

    expect(resolution.status).toBe('ambiguous')
  })

  it('keeps delete scope explicit and closed', () => {
    const scope = {
      kind: 'app',
      bundleId: 'com.google.Chrome',
    } satisfies DeleteHistoryScope

    expect(scope.kind).toBe('app')
  })
})
