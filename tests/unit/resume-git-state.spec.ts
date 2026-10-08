import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  enrichResumeHandoff,
  probeCheckpointGitHead,
  probeResumeGitState,
} from '../../src/host/resume/index.js'
import type { ResumeHandoff } from '../../src/shared/index.js'

function context(output: string, exitCode = 0): Context {
  return {
    subprocess: {
      spawn: () => ({
        done: Promise.resolve({ exitCode, signal: null }),
        collected: {
          stdout: {
            readFrom: () => ({
              text: output,
              nextOffset: Buffer.byteLength(output),
              lossy: false,
            }),
          },
        },
      }),
    },
  } as unknown as Context
}

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

    await expect(probeCheckpointGitHead(ctx, '/tmp/workspace')).resolves.toBe(sha)
    expect(calls).toEqual([[
      'git', '-C', '/tmp/workspace', 'rev-parse', '--verify', 'HEAD',
    ]])
    expect(calls.flat()).not.toContain('status')
    expect(calls.flat()).not.toContain('diff')
  })

  it('reads branch, HEAD and file-status metadata without asking for a diff', async () => {
    const output = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head feat/work-continuity',
      '1 .M N... 100644 100644 100644 aaa aaa src/host/resume/handoff.ts',
      '1 M. N... 100644 100644 100644 bbb ccc src/agent/tools.ts',
      '? tests/unit/new case.spec.ts',
      '',
    ].join('\n')

    await expect(probeResumeGitState(
      context(output),
      '/tmp/workspace',
      () => 123_456,
    )).resolves.toEqual({
      observedAtMs: 123_456,
      branch: 'feat/work-continuity',
      head: '0123456789abcdef0123456789abcdef01234567',
      dirty: true,
      changedFiles: [
        { path: 'src/host/resume/handoff.ts', status: '.M' },
        { path: 'src/agent/tools.ts', status: 'M.' },
        { path: 'tests/unit/new case.spec.ts', status: '??' },
      ],
      truncated: false,
    })
  })

  it('adds current Git metadata only to a concrete handoff', async () => {
    const handoff: ResumeHandoff = {
      status: 'hit',
      episodeId: 'episode-1' as never,
      workspace: { root: '/tmp/workspace', title: 'workspace' },
      startedAtMs: 1,
      lastActiveAtMs: 1,
      recentResources: [],
      referenceResources: [],
      changedResources: [],
      verifications: [],
      surfaces: [],
      confidence: 0.9,
      reasons: ['current-workspace'],
      evidenceObservationIds: [1 as never],
    }
    const enriched = await enrichResumeHandoff(
      context('# branch.oid (initial)\n# branch.head main\n'),
      handoff,
    )
    expect(enriched).toMatchObject({
      status: 'hit',
      git: {
        observedAtMs: expect.any(Number),
        branch: 'main',
        dirty: false,
        changedFiles: [],
        truncated: false,
      },
    })
  })
})
