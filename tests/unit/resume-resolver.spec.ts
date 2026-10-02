import { describe, expect, it } from 'vitest'
import { resolveResume } from '../../src/host/resume/index.js'
import type { EpisodeSummary } from '../../src/shared/index.js'
import { resumeEpisodes } from '../fixtures/resume-episodes.js'

function resolve(query: string, currentWorkspaceId?: string) {
  return resolveResume(resumeEpisodes, {
    query,
    nowMs: 10_000,
    ...(currentWorkspaceId ? { currentWorkspaceId } : {}),
    turn: 1,
    source: 'automatic',
  })
}

describe('resume resolver', () => {
  it('uses explicit workspace before recency', () => {
    const result = resolve('继续 beta 那个')
    expect(result.status).toBe('hit')
    if (result.status === 'hit') {
      expect(result.episode.workspace?.id).toBe('beta')
      expect(result.reasons).toEqual(['explicit-workspace'])
    }
  })

  it('uses exact unique resource identity', () => {
    const result = resolve('继续 server.ts')
    expect(result.status).toBe('hit')
    if (result.status === 'hit') {
      expect(result.episode.workspace?.id).toBe('gamma')
      expect(result.reasons).toEqual(['exact-resource'])
    }
  })

  it('abstains on same-named resources across workspaces', () => {
    const result = resolve('继续 provider.ts')
    expect(result.status).toBe('ambiguous')
  })

  it('uses current workspace to resolve ambiguous resource', () => {
    const result = resolve('继续 provider.ts', 'beta')
    expect(result.status).toBe('hit')
    if (result.status === 'hit') {
      expect(result.episode.workspace?.id).toBe('beta')
    }
  })

  it('uses surface-specific recency', () => {
    const browser = resolve('继续刚才浏览器里的')
    expect(browser.status).toBe('hit')
    if (browser.status === 'hit') {
      expect(browser.episode.workspace?.id).toBe('gamma')
    }

    const editor = resolve('继续刚才 VS Code 里的')
    expect(editor.status).toBe('hit')
    if (editor.status === 'hit') {
      expect(editor.episode.workspace?.id).toBe('alpha')
    }
  })

  it('uses current workspace before pure recency', () => {
    const result = resolve('继续刚才的', 'gamma')
    expect(result.status).toBe('hit')
    if (result.status === 'hit') {
      expect(result.episode.workspace?.id).toBe('gamma')
    }
  })

  it('falls back to most recent eligible episode', () => {
    const result = resolve('继续刚才的')
    expect(result.status).toBe('hit')
    if (result.status === 'hit') {
      expect(result.episode.workspace?.id).toBe('alpha')
    }
  })

  it('does not resolve unrelated query', () => {
    expect(resolve('今天天气怎么样')).toEqual({
      status: 'none',
      reason: 'query is not eligible for automatic resume',
    })
  })
})

describe('a hint must be checkable (ADR 0004 §5)', () => {
  it('carries the resource to reopen and the citations behind it', () => {
    const result = resolve('继续 beta 那个')
    expect(result.status).toBe('hit')
    if (result.status === 'hit') {
      expect(result.citations.length).toBeGreaterThan(0)
      expect(result.citations).toEqual(result.episode.summaryObservationIds)
      expect(result.resource).toBeDefined()
    }
  })

  it('refuses to answer with an episode that has no citations', () => {
    // The same query, against the same episodes, but with the evidence removed:
    // an unchecked suggestion is not a hint, so the resolver says none instead
    // of guessing.
    // A plain loop: oxlint flags object spreads inside `map`, and this is a
    // test fixture, not a hot path.
    const uncited: EpisodeSummary[] = []
    for (const episode of resumeEpisodes) {
      uncited.push({
        id: episode.id,
        startedAtMs: episode.startedAtMs,
        endedAtMs: episode.endedAtMs,
        boundary: episode.boundary,
        ...(episode.workspace ? { workspace: episode.workspace } : {}),
        ...(episode.threadKey ? { threadKey: episode.threadKey } : {}),
        summaryKind: episode.summaryKind,
        summary: episode.summary,
        summaryObservationIds: [],
        ...(episode.lastStrongResource
          ? { lastStrongResource: episode.lastStrongResource }
          : {}),
        resources: episode.resources,
        surfaces: episode.surfaces,
        confidence: episode.confidence,
        state: episode.state,
      })
    }
    const result = resolveResume(uncited, {
      query: '继续 beta 那个',
      nowMs: 10_000,
      turn: 1,
      source: 'automatic',
    })
    expect(result.status).toBe('none')
    if (result.status === 'none') {
      expect(result.reason).toContain('citations')
    }
  })
})
