import { describe, expect, it } from 'vitest'
import { resolveResume } from '../../../src/host/resume/index.js'
import { resumeEpisodes } from '../../fixtures/resume-episodes.js'

interface HoldoutCase {
  readonly query: string
  readonly expected: string
  readonly currentWorkspaceId?: string
}

const cases: readonly HoldoutCase[] = [
  { query: '把刚才那个继续做下去', expected: 'alpha' },
  { query: '刚才那个接着来', expected: 'alpha' },
  { query: '恢复 alpha 的工作', expected: 'alpha' },
  { query: '回到我刚才看的 PDF', expected: 'alpha' },
  { query: 'beta 继续', expected: 'beta' },
  { query: 'gamma 那个接着做', expected: 'gamma' },
  { query: 'server.ts 接着', expected: 'gamma' },
  { query: '刚才浏览器里看的继续', expected: 'gamma' },
  { query: '刚才终端那个接着', expected: 'gamma' },
  { query: '刚才 VS Code 那个接着', expected: 'alpha' },
  { query: '回到刚才的网页', expected: 'gamma' },
  { query: 'provider.ts 继续', expected: 'ambiguous' },
  { query: '那个 provider.ts 接着做', expected: 'ambiguous' },
  { query: '恢复上次 provider.ts', expected: 'ambiguous' },
  { query: '接着做', expected: 'beta', currentWorkspaceId: 'beta' },
  { query: '继续', expected: 'gamma', currentWorkspaceId: 'gamma' },
  { query: '回到 alpha 的 spec.pdf', expected: 'alpha' },
  { query: '继续 deploy.html', expected: 'gamma' },
  { query: '接着 retry.html', expected: 'ambiguous' },
  { query: 'continue last terminal task', expected: 'gamma' },
]

function outcome(value: ReturnType<typeof resolveResume>): string {
  if (value.status === 'ambiguous') return 'ambiguous'
  if (value.status === 'none') return 'none'
  return value.episode.workspace?.id ?? value.episode.id
}

describe('fresh resume holdout', () => {
  it.each(cases)(
    '$query -> $expected',
    ({ query, expected, currentWorkspaceId }) => {
      const result = resolveResume(resumeEpisodes, {
        query,
        nowMs: 20_000,
        ...(currentWorkspaceId ? { currentWorkspaceId } : {}),
        turn: 1,
        source: 'automatic',
      })
      expect(outcome(result)).toBe(expected)
    },
  )
})
