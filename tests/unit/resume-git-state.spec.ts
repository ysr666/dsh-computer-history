import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { probeCheckpointGitHead } from '../../src/host/resume/git-state.js'

describe('Resume Git state', () => {
  it('reads only HEAD for a checkpoint and never scans the worktree', async () => {
    const calls: string[][] = []
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const ctx = {
      subprocess: {
        spawn({ argv }: { argv: string[] }) {
          calls.push(argv)
          return {
            done: Promise.resolve({ exitCode: 0, signal: null }),
            collected: {
              stdout: {
                readFrom: () => ({
                  text: sha + '\n',
                  nextOffset: sha.length + 1,
                  lossy: false,
                }),
              },
            },
          }
        },
      },
    } as unknown as Context

    await expect(
      probeCheckpointGitHead(ctx, '/tmp/workspace'),
    ).resolves.toBe(sha)
    expect(calls).toEqual([[
      'git', '-C', '/tmp/workspace', 'rev-parse', '--verify', 'HEAD',
    ]])
    expect(calls.flat()).not.toContain('status')
    expect(calls.flat()).not.toContain('diff')
  })
})
