import { describe, expect, it } from 'vitest'
import { pickContinuationEpisode } from '../../../src/client/episode-subject.js'
import { resolveResume } from '../../../src/host/resume/index.js'
import { EpisodeId, type EpisodeSummary } from '../../../src/shared/index.js'

function episode(input: {
  id: string
  endedAtMs: number
  workspace?: string
  resource?: { kind: 'file' | 'url' | 'directory'; uri: string; label: string }
  surface: 'editor' | 'terminal' | 'browser' | 'window'
  bundleId: string
  state?: 'open' | 'closed' | 'invalidated'
}): EpisodeSummary {
  const resource = input.resource
  return {
    id: EpisodeId(input.id),
    startedAtMs: input.endedAtMs - 500,
    endedAtMs: input.endedAtMs,
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    ...(input.workspace ? {
      workspace: {
        id: input.workspace,
        root: '/repo/' + input.workspace,
        title: input.workspace,
      },
      threadKey: 'workspace:' + input.workspace,
    } : {}),
    summaryKind: 'deterministic',
    summary: input.id,
    summaryObservationIds: [1 as never],
    ...(resource ? {
      lastStrongResource: {
        kind: resource.kind,
        canonicalUri: resource.uri,
        displayLabel: resource.label,
      },
      resources: [{
        kind: resource.kind,
        canonicalUri: resource.uri,
        displayLabel: resource.label,
        firstSeenAtMs: input.endedAtMs - 200,
        lastSeenAtMs: input.endedAtMs,
        observationCount: 1,
      }],
    } : { resources: [] }),
    surfaces: [{
      bundleId: input.bundleId,
      surfaceKind: input.surface,
      firstSeenAtMs: input.endedAtMs - 500,
      lastSeenAtMs: input.endedAtMs,
      observationCount: 1,
    }],
    confidence: 0.9,
    state: input.state ?? 'closed',
  }
}

function genericId(episodes: readonly EpisodeSummary[]): string | undefined {
  const result = resolveResume(episodes, {
    query: '接着做',
    nowMs: 100_000,
    turn: 1,
    source: 'automatic',
  })
  return result.status === 'hit' ? String(result.episode.id) : undefined
}

function panelId(episodes: readonly EpisodeSummary[]): string | undefined {
  return pickContinuationEpisode(episodes)?.id
}

function expectBoth(
  episodes: readonly EpisodeSummary[],
  expected: string | undefined,
): void {
  expect(panelId(episodes)).toBe(expected)
  expect(genericId(episodes)).toBe(expected)
}

describe('generic Continue selection holdout', () => {
  const alpha = episode({
    id: 'alpha',
    endedAtMs: 10_000,
    workspace: 'alpha',
    resource: {
      kind: 'file',
      uri: 'file:///repo/alpha/main.ts',
      label: 'main.ts',
    },
    surface: 'editor',
    bundleId: 'com.microsoft.VSCode',
  })

  it('keeps a standalone URL as newer real work', () => {
    const docs = episode({
      id: 'docs',
      endedAtMs: 20_000,
      resource: {
        kind: 'url',
        uri: 'https://example.test/design',
        label: 'Design',
      },
      surface: 'browser',
      bundleId: 'com.google.Chrome',
    })
    expectBoth([docs, alpha], 'docs')
  })

  it('skips passive Notes/Finder-like activity after a URL-backed task', () => {
    const docs = episode({
      id: 'docs',
      endedAtMs: 20_000,
      resource: {
        kind: 'url',
        uri: 'https://example.test/design',
        label: 'Design',
      },
      surface: 'browser',
      bundleId: 'com.google.Chrome',
    })
    const passive = episode({
      id: 'passive',
      endedAtMs: 30_000,
      surface: 'window',
      bundleId: 'com.apple.Notes',
    })
    expectBoth([passive, docs, alpha], 'docs')
  })

  it('uses the genuinely newer repo after a strong workspace switch', () => {
    const beta = episode({
      id: 'beta',
      endedAtMs: 20_000,
      workspace: 'beta',
      resource: {
        kind: 'file',
        uri: 'file:///repo/beta/server.ts',
        label: 'server.ts',
      },
      surface: 'editor',
      bundleId: 'com.microsoft.VSCode',
    })
    expectBoth([beta, alpha], 'beta')
  })

  it('returns to alpha after an A -> B -> A sequence', () => {
    const beta = episode({
      id: 'beta',
      endedAtMs: 20_000,
      workspace: 'beta',
      resource: {
        kind: 'file',
        uri: 'file:///repo/beta/server.ts',
        label: 'server.ts',
      },
      surface: 'editor',
      bundleId: 'com.microsoft.VSCode',
    })
    const alphaAgain = episode({
      id: 'alpha-again',
      endedAtMs: 30_000,
      workspace: 'alpha',
      resource: {
        kind: 'file',
        uri: 'file:///repo/alpha/main.ts',
        label: 'main.ts',
      },
      surface: 'editor',
      bundleId: 'com.microsoft.VSCode',
    })
    expectBoth([alphaAgain, beta, alpha], 'alpha-again')
  })

  it('does not let an invalidated newer episode win', () => {
    const invalid = episode({
      id: 'invalid',
      endedAtMs: 30_000,
      workspace: 'broken',
      resource: {
        kind: 'file',
        uri: 'file:///repo/broken/nope.ts',
        label: 'nope.ts',
      },
      surface: 'editor',
      bundleId: 'com.microsoft.VSCode',
      state: 'invalidated',
    })
    expectBoth([invalid, alpha], 'alpha')
  })

  it('skips a terminal tail but explicit terminal resume remains available', () => {
    const terminal = episode({
      id: 'terminal',
      endedAtMs: 20_000,
      workspace: 'alpha',
      resource: {
        kind: 'directory',
        uri: 'file:///repo/alpha',
        label: 'alpha',
      },
      surface: 'terminal',
      bundleId: 'com.apple.Terminal',
    })
    expectBoth([terminal, alpha], 'alpha')

    const explicit = resolveResume([terminal, alpha], {
      query: '继续刚才终端里的',
      nowMs: 100_000,
      turn: 1,
      source: 'automatic',
    })
    expect(explicit.status).toBe('hit')
    if (explicit.status === 'hit') {
      expect(String(explicit.episode.id)).toBe('terminal')
    }
  })
})
