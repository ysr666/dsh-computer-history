import { describe, expect, it } from 'vitest'
import { resolveResume } from '../../../src/host/resume/index.js'
import { resumeEpisodes } from '../../fixtures/resume-episodes.js'

interface Case {
  readonly query: string
  readonly expected: string
  readonly currentWorkspaceId?: string
}

const cases: readonly Case[] = [
  { query: '继续刚才的', expected: 'alpha' },
  { query: '接着刚才那个', expected: 'alpha' },
  { query: 'resume last work', expected: 'alpha' },
  { query: 'continue what I was doing', expected: 'alpha' },
  { query: '回到 alpha', expected: 'alpha' },
  { query: '继续 alpha 那个', expected: 'alpha' },
  { query: '接着 alpha 的工作', expected: 'alpha' },
  { query: '回到 beta', expected: 'beta' },
  { query: '继续 beta 那个', expected: 'beta' },
  { query: 'resume beta', expected: 'beta' },
  { query: '回到 gamma', expected: 'gamma' },
  { query: '继续 gamma', expected: 'gamma' },
  { query: '接着 gamma 那个', expected: 'gamma' },
  { query: '继续 server.ts', expected: 'gamma' },
  { query: '回到 spec.pdf', expected: 'alpha' },
  { query: '继续 deploy.html', expected: 'gamma' },
  { query: '继续刚才浏览器里的', expected: 'gamma' },
  { query: '接着终端里的', expected: 'gamma' },
  { query: '继续 VS Code 里刚才那个', expected: 'alpha' },
  { query: '继续刚才预览的 PDF', expected: 'alpha' },
  { query: '继续 provider.ts', expected: 'ambiguous' },
  { query: '回到 provider.ts', expected: 'ambiguous' },
  { query: '接着 retry.html', expected: 'ambiguous' },
  { query: '继续刚才的', expected: 'beta', currentWorkspaceId: 'beta' },
  { query: '继续 provider.ts', expected: 'beta', currentWorkspaceId: 'beta' },
]

function outcome(value: ReturnType<typeof resolveResume>): string {
  if (value.status === 'ambiguous') return 'ambiguous'
  if (value.status === 'none') return 'none'
  return value.episode.workspace?.id ?? value.episode.id
}

describe('resume development benchmark', () => {
  it.each(cases)(
    '$query -> $expected',
    ({ query, expected, currentWorkspaceId }) => {
      const result = resolveResume(resumeEpisodes, {
        query,
        nowMs: 10_000,
        ...(currentWorkspaceId ? { currentWorkspaceId } : {}),
        turn: 1,
        source: 'automatic',
      })
      expect(outcome(result)).toBe(expected)
    },
  )
})
