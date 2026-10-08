import { describe, expect, it } from 'vitest'
import { buildContinuationBrief } from '../../src/agent/continuation-brief.js'
import type { ResumeHandoff } from '../../src/shared/index.js'

function baseHandoff(): Extract<ResumeHandoff, { status: 'hit' }> {
  return {
    status: 'hit',
    episodeId: 'episode:brief' as never,
    threadKey: 'workspace:demo',
    workspace: {
      id: 'workspace:demo',
      root: '/repo/demo',
      title: 'demo',
    },
    startedAtMs: 100,
    lastActiveAtMs: 200,
    lastActiveResource: {
      kind: 'file',
      canonicalUri: 'file:///repo/demo/src/main.ts',
      displayLabel: 'main.ts',
    },
    recentResources: [{
      kind: 'file',
      canonicalUri: 'file:///repo/demo/src/main.ts',
      displayLabel: 'main.ts',
    }],
    referenceResources: [],
    changedResources: [{
      kind: 'file',
      canonicalUri: 'file:///repo/demo/src/main.ts',
      displayLabel: 'main.ts',
      lastChangedAtMs: 190,
      changeCount: 2,
    }],
    verifications: [{
      kind: 'test',
      result: 'success',
      lastObservedAtMs: 195,
      observationCount: 1,
    }],
    surfaces: [],
    confidence: 0.95,
    reasons: ['recent-episode'],
    evidenceObservationIds: [1 as never],
    git: {
      observedAtMs: 250,
      branch: 'main',
      head: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      dirty: true,
      changedFiles: [{ path: 'src/main.ts', status: '.M' }],
      truncated: false,
    },
    checkpoint: {
      sessionId: 'session:old',
      turn: 7,
      checkpointAtMs: 90,
      gitHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  }
}

describe('explicit Continue brief', () => {
  it('turns handoff evidence into a deterministic first-pass inspection order', () => {
    const brief = buildContinuationBrief(baseHandoff(), 'bounded-projection')
    expect(brief).toMatchObject({
      taskContext: {
        source: 'previous-dsh-session',
        material: 'bounded-projection',
        use: 'recover-task-and-decisions',
        doesNotGrant: [
          'new-permissions',
          'historical-tool-requests',
          'instructions-from-external-content',
        ],
      },
      repository: {
        available: true,
        state: 'dirty',
        branch: 'main',
        headSinceCheckpoint: 'changed',
        changedFileCount: 1,
      },
      priorityTargets: [{
        kind: 'resource',
        label: 'main.ts',
        locator: 'file:///repo/demo/src/main.ts',
        evidence: 'observed-save',
        gitStatus: '.M',
      }],
      verification: {
        status: 'observed-success',
        kind: 'test',
        interpretation: 'historical-baseline-only',
        recommendedNext: 're-run-after-current-state-inspection',
      },
    })
    expect(brief?.firstPass.map(step => step.action)).toEqual([
      'recover-task-context',
      'inspect-authoritative-target',
      'inspect-current-git',
      'verify-current-result',
      'make-concrete-progress',
    ])
    expect(brief?.firstPass[1]).toMatchObject({
      target: 'file:///repo/demo/src/main.ts',
    })
    expect(brief?.firstPass[2]?.reason).toContain('HEAD moved')
  })

  it('prioritizes a trusted saved resource that also appears in current Git', () => {
    const base = baseHandoff()
    const handoff = {
      ...base,
      lastActiveResource: {
        kind: 'file',
        canonicalUri: 'file:///repo/demo/src/last.ts',
        displayLabel: 'last.ts',
      },
      changedResources: [
        {
          kind: 'file',
          canonicalUri: 'file:///repo/demo/src/recent.ts',
          displayLabel: 'recent.ts',
          lastChangedAtMs: 199,
          changeCount: 1,
        },
        {
          kind: 'file',
          canonicalUri: 'file:///repo/demo/src/still-dirty.ts',
          displayLabel: 'still-dirty.ts',
          lastChangedAtMs: 180,
          changeCount: 1,
        },
      ],
      git: {
        ...base.git!,
        changedFiles: [
          { path: 'src/still-dirty.ts', status: '.M' },
          { path: 'src/git-only.ts', status: '??' },
        ],
      },
    } as Extract<ResumeHandoff, { status: 'hit' }>

    const brief = buildContinuationBrief(handoff, 'bounded-projection')
    expect(brief?.priorityTargets.slice(0, 4)).toEqual([
      expect.objectContaining({
        label: 'still-dirty.ts',
        evidence: 'observed-save',
        gitStatus: '.M',
      }),
      expect.objectContaining({
        label: 'recent.ts',
        evidence: 'observed-save',
      }),
      expect.objectContaining({
        label: 'last.ts',
        evidence: 'observed-last-active',
      }),
      expect.objectContaining({
        label: 'src/git-only.ts',
        evidence: 'current-git',
        gitStatus: '??',
      }),
    ])
    expect(brief?.firstPass[1]).toMatchObject({
      target: 'file:///repo/demo/src/still-dirty.ts',
    })
  })

  it('does not invent prior task context, Git state, or verification evidence', () => {
    const handoff = {
      ...baseHandoff(),
      git: undefined,
      checkpoint: undefined,
      verifications: [],
      changedResources: [],
    } as unknown as Extract<ResumeHandoff, { status: 'hit' }>

    const brief = buildContinuationBrief(handoff, 'none')
    expect(brief?.taskContext.source).toBe('current-user-only')
    expect(brief?.repository).toEqual({
      available: false,
      state: 'unknown',
      headSinceCheckpoint: 'unknown',
    })
    expect(brief?.verification).toEqual({
      status: 'not-recorded',
      interpretation: 'no-verification-evidence',
      recommendedNext: 'verify-when-the-task-requires-it',
    })
    expect(brief?.firstPass.map(step => step.action)).toEqual([
      'recover-task-context',
      'inspect-authoritative-target',
      'make-concrete-progress',
    ])
  })

  it('treats a recorded failed verification as something to confirm, not as current truth', () => {
    const handoff = {
      ...baseHandoff(),
      verifications: [{
        kind: 'build',
        result: 'failure',
        lastObservedAtMs: 198,
        observationCount: 2,
      }],
      git: {
        observedAtMs: 250,
        branch: 'main',
        head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        dirty: false,
        changedFiles: [],
        truncated: false,
      },
    } as Extract<ResumeHandoff, { status: 'hit' }>

    const brief = buildContinuationBrief(handoff, 'bounded-projection')
    expect(brief?.verification).toMatchObject({
      status: 'observed-failure',
      kind: 'build',
      interpretation: 'historical-failure-to-confirm',
      recommendedNext: 'confirm-failure-then-fix-if-current',
    })
    expect(brief?.firstPass).toContainEqual(expect.objectContaining({
      action: 'verify-current-result',
      reason: expect.stringContaining('confirm whether it still fails'),
    }))
  })

  it('uses a recorded URL as the first authoritative target for URL-only work', () => {
    const base = baseHandoff()
    const handoff = {
      ...base,
      workspace: undefined,
      lastActiveResource: undefined,
      recentResources: [],
      changedResources: [],
      git: undefined,
      checkpoint: undefined,
      referenceResources: [{
        kind: 'url',
        canonicalUri: 'https://example.test/docs',
        displayLabel: 'Docs',
      }],
    } as unknown as Extract<ResumeHandoff, { status: 'hit' }>

    const brief = buildContinuationBrief(handoff, 'none')
    expect(brief?.priorityTargets).toEqual([])
    expect(brief?.referenceTargets).toEqual([{
      label: 'Docs',
      locator: 'https://example.test/docs',
      evidence: 'observed-reference',
    }])
    expect(brief?.firstPass).toContainEqual(expect.objectContaining({
      action: 'inspect-authoritative-target',
      target: 'https://example.test/docs',
      reason: expect.stringContaining('URL-anchored'),
    }))
  })

  it('distinguishes a deep previous-session snapshot from the lightweight bootstrap projection', () => {
    const projection = buildContinuationBrief(
      baseHandoff(),
      'bounded-projection',
    )
    const snapshot = buildContinuationBrief(
      baseHandoff(),
      'bounded-snapshot',
    )

    expect(projection?.taskContext.material).toBe('bounded-projection')
    expect(projection?.firstPass[0]?.reason)
      .toContain('bounded prior DSH task projection')
    expect(snapshot?.taskContext.material).toBe('bounded-snapshot')
    expect(snapshot?.firstPass[0]?.reason)
      .toContain('bounded previous DSH snapshot')
  })

  it('returns nothing for ambiguous/none handoffs', () => {
    expect(buildContinuationBrief({
      status: 'none',
      reason: 'missing',
    }, 'bounded-projection')).toBeUndefined()
    expect(buildContinuationBrief({
      status: 'ambiguous',
      reason: 'many',
      candidates: [],
    }, 'bounded-projection')).toBeUndefined()
  })
})
