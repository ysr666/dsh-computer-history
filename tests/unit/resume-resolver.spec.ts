import { describe, expect, it } from 'vitest'
import { resolveResume } from '../../src/host/resume/index.js'
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
