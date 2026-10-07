import { describe, expect, it } from 'vitest'
import { pickContinuationEpisode } from '../../../src/client/episode-subject.js'
import { resolveResume } from '../../../src/host/resume/index.js'
import { EpisodeId, type EpisodeSummary } from '../../../src/shared/index.js'

function episode(input: {
  id: string
  endedAtMs: number
  workspace?: string
  resource?: {
    kind: 'file' | 'url' | 'directory'
    uri: string
    label: string
  }
  surface: 'editor' | 'terminal' | 'browser' | 'window'
  bundleId: string
  confidence?: number
}): EpisodeSummary {
  const resource = input.resource
  return {
    id: EpisodeId(input.id),
    startedAtMs: input.endedAtMs - 1_000,
    endedAtMs: input.endedAtMs,
    boundary: {
      startReason: 'first-observation',
      endReason: 'timeout',
    },
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
        firstSeenAtMs: input.endedAtMs - 500,
        lastSeenAtMs: input.endedAtMs,
        observationCount: 1,
      }],
    } : { resources: [] }),
    surfaces: [{
      bundleId: input.bundleId,
      surfaceKind: input.surface,
      firstSeenAtMs: input.endedAtMs - 1_000,
      lastSeenAtMs: input.endedAtMs,
      observationCount: 1,
    }],
    confidence: input.confidence ?? 0.9,
    state: 'closed',
  }
}

function genericResume(episodes: readonly EpisodeSummary[]) {
  return resolveResume(episodes, {
    query: '继续刚才的',
    nowMs: 20_000,
    turn: 1,
    source: 'automatic',
  })
}

function resolvedId(episodes: readonly EpisodeSummary[]): string | undefined {
  const result = genericResume(episodes)
  return result.status === 'hit' ? String(result.episode.id) : undefined
}

describe('generic Continue candidate accuracy', () => {
  const project = episode({
    id: 'project',
    endedAtMs: 10_000,
    workspace: 'project',
    resource: {
      kind: 'file',
      uri: 'file:///repo/project/src/main.ts',
      label: 'main.ts',
    },
    surface: 'editor',
    bundleId: 'com.microsoft.VSCode',
  })

  it('does not let a Finder-only tail displace anchored work', () => {
    const finder = episode({
      id: 'finder-tail',
      endedAtMs: 11_000,
      surface: 'window',
      bundleId: 'com.apple.finder',
      confidence: 0.4,
    })
    const episodes = [finder, project]

    expect(String(pickContinuationEpisode(episodes)?.id)).toBe('project')
    expect(resolvedId(episodes)).toBe('project')
  })

  it('abstains when there is only passive window activity', () => {
    const finder = episode({
      id: 'finder-only',
      endedAtMs: 11_000,
      surface: 'window',
      bundleId: 'com.apple.finder',
      confidence: 0.4,
    })

    expect(pickContinuationEpisode([finder])).toBeUndefined()
    expect(genericResume([finder]).status).toBe('none')
  })

  it('does not let a terminal-only tail displace the project card', () => {
    const terminal = episode({
      id: 'terminal-tail',
      endedAtMs: 11_000,
      workspace: 'project',
      resource: {
        kind: 'directory',
        uri: 'file:///repo/project',
        label: 'project',
      },
      surface: 'terminal',
      bundleId: 'com.apple.Terminal',
    })
    const episodes = [terminal, project]

    expect(String(pickContinuationEpisode(episodes)?.id)).toBe('project')
    expect(resolvedId(episodes)).toBe('project')
  })

  it('does not let an unauditable anchored episode displace cited work', () => {
    const unauditable = {
      ...project,
      id: EpisodeId('unauditable'),
      endedAtMs: 11_000,
      summaryObservationIds: [],
    }
    const episodes = [unauditable, project]

    expect(String(pickContinuationEpisode(episodes)?.id)).toBe('project')
    expect(resolvedId(episodes)).toBe('project')
  })

  it('abstains when the only anchored Episode has no auditable evidence', () => {
    const unauditable = {
      ...project,
      id: EpisodeId('unauditable-only'),
      endedAtMs: 11_000,
      summaryObservationIds: [],
    }

    expect(pickContinuationEpisode([unauditable])).toBeUndefined()
    expect(genericResume([unauditable]).status).toBe('none')
  })

  it('keeps a URL-backed browser episode eligible as standalone work', () => {
    const browser = episode({
      id: 'browser',
      endedAtMs: 11_000,
      resource: {
        kind: 'url',
        uri: 'https://docs.example/work',
        label: 'work',
      },
      surface: 'browser',
      bundleId: 'com.google.Chrome',
    })
    const episodes = [browser, project]

    expect(String(pickContinuationEpisode(episodes)?.id)).toBe('browser')
    expect(resolvedId(episodes)).toBe('browser')
  })

  it('does not treat a title-only editor window as an automatic continuation target', () => {
    const titleOnly = episode({
      id: 'title-only',
      endedAtMs: 11_000,
      surface: 'editor',
      bundleId: 'Notepad.exe',
      confidence: 0.4,
    })
    const episodes = [titleOnly, project]

    expect(String(pickContinuationEpisode(episodes)?.id)).toBe('project')
    expect(resolvedId(episodes)).toBe('project')
  })
})
