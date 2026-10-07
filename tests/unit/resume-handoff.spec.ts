import { describe, expect, it } from 'vitest'
import {
  attachDshCheckpoint,
  buildPriorThreadTail,
  buildResumeHandoff,
  buildUrlDetourBridge,
  buildResumeHandoffFromEpisode,
  resolveResume,
} from '../../src/host/resume/index.js'
import { resumeEpisodes } from '../fixtures/resume-episodes.js'
import { EpisodeId } from '../../src/shared/index.js'

describe('ResumeHandoff', () => {
  it('projects a hit into structured continuation state without carrying summary prose', () => {
    const resolution = resolveResume(resumeEpisodes, {
      query: '继续 server.ts',
      nowMs: 10_000,
      turn: 1,
      source: 'tool',
    })
    const handoff = buildResumeHandoff(resolution)

    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')

    expect(handoff.workspace?.id).toBe('gamma')
    expect(handoff.threadKey).toBe('workspace:gamma')
    expect(handoff.lastActiveResource?.displayLabel).toBe('server.ts')
    expect(handoff.recentResources.map(resource => resource.displayLabel))
      .toEqual(['server.ts', 'deploy.html'])
    expect(handoff.referenceResources).toEqual([
      expect.objectContaining({
        kind: 'url',
        displayLabel: 'deploy.html',
        canonicalUri: 'https://docs.example/deploy.html',
      }),
    ])
    expect(handoff.changedResources).toEqual([])
    expect(handoff.surfaces.map(surface => surface.surfaceKind))
      .toEqual(['terminal', 'browser', 'editor'])
    expect(handoff.confidence).toBe(0.95)
    expect(handoff.evidenceObservationIds.length).toBeGreaterThan(0)
    expect(handoff).not.toHaveProperty('summary')
  })

  it('uses raw Episode provenance for explicit Continue even when summary prose has no citations', () => {
    const base = resumeEpisodes[0]!
    const handoff = buildResumeHandoffFromEpisode({
      ...base,
      summaryObservationIds: [],
      observationIds: [901 as never, 902 as never],
    } as typeof base & { readonly observationIds: readonly never[] })

    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')
    expect(handoff.evidenceObservationIds).toEqual([901, 902])
    expect(handoff).not.toHaveProperty('summary')
  })

  it('still refuses an explicit Episode when neither raw nor summary provenance exists', () => {
    const base = resumeEpisodes[0]!
    const handoff = buildResumeHandoffFromEpisode({
      ...base,
      summaryObservationIds: [],
      observationIds: [],
    } as typeof base & { readonly observationIds: readonly never[] })

    expect(handoff).toEqual({
      status: 'none',
      reason: 'episode has no auditable evidence',
    })
  })

  it('builds a bounded auditable tail from only the immediately preceding same-thread episodes', () => {
    const anchorBase = resumeEpisodes[2]!
    const anchor = {
      ...anchorBase,
      id: EpisodeId('thread-anchor'),
      startedAtMs: 4_000_000,
      endedAtMs: 4_010_000,
      summaryObservationIds: [40 as never],
    }
    const priorNew = {
      ...anchorBase,
      id: EpisodeId('thread-prior-new'),
      startedAtMs: 3_900_000,
      endedAtMs: 3_950_000,
      summaryObservationIds: [30 as never],
      resources: [{
        kind: 'file' as const,
        canonicalUri: 'file:///gamma/src/new.ts',
        displayLabel: 'new.ts',
        firstSeenAtMs: 3_900_000,
        lastSeenAtMs: 3_950_000,
        observationCount: 2,
      }],
      changedResources: [{
        kind: 'file' as const,
        canonicalUri: 'file:///gamma/src/new.ts',
        displayLabel: 'new.ts',
        lastChangedAtMs: 3_940_000,
        changeCount: 2,
      }],
      verifications: [{
        kind: 'test' as const,
        result: 'success' as const,
        lastObservedAtMs: 3_945_000,
        observationCount: 1,
      }],
    }
    const priorOld = {
      ...anchorBase,
      id: EpisodeId('thread-prior-old'),
      startedAtMs: 3_800_000,
      endedAtMs: 3_850_000,
      summaryObservationIds: [20 as never],
      resources: [{
        kind: 'url' as const,
        canonicalUri: 'https://docs.example/thread-context',
        displayLabel: 'thread-context',
        firstSeenAtMs: 3_800_000,
        lastSeenAtMs: 3_850_000,
        observationCount: 1,
      }],
    }
    const stale = {
      ...anchorBase,
      id: EpisodeId('thread-stale'),
      startedAtMs: 900_000,
      endedAtMs: 1_000_000,
      summaryObservationIds: [10 as never],
      resources: [{
        kind: 'file' as const,
        canonicalUri: 'file:///gamma/src/stale.ts',
        displayLabel: 'stale.ts',
        firstSeenAtMs: 900_000,
        lastSeenAtMs: 1_000_000,
        observationCount: 1,
      }],
    }

    const tail = buildPriorThreadTail(
      [stale, priorOld, priorNew, anchor],
      anchor.id,
    )

    expect(tail).toMatchObject({
      episodeIds: [priorOld.id, priorNew.id],
      evidenceObservationIds: [20, 30],
    })
    expect(tail?.recentResources.map(resource => resource.displayLabel))
      .toEqual(['new.ts', 'thread-context'])
    expect(tail?.referenceResources.map(resource => resource.displayLabel))
      .toEqual(['thread-context'])
    expect(tail?.changedResources).toEqual([
      expect.objectContaining({ displayLabel: 'new.ts', changeCount: 2 }),
    ])
    expect(tail?.verifications).toEqual([
      expect.objectContaining({ kind: 'test', result: 'success' }),
    ])
    expect(tail?.episodeIds).not.toContain(stale.id)
  })

  it('bridges exactly one URL-only browser detour only when the same thread closes the loop', () => {
    const base = resumeEpisodes[2]!
    const previous = {
      ...base,
      id: EpisodeId('bridge-previous'),
      startedAtMs: 1_000,
      endedAtMs: 2_000,
      boundary: {
        startReason: 'first-observation' as const,
        endReason: 'workspace-switch' as const,
      },
      summaryObservationIds: [11 as never],
    }
    const anchorEpisode = {
      ...base,
      id: EpisodeId('bridge-anchor'),
      startedAtMs: 5_000,
      endedAtMs: 6_000,
      boundary: {
        startReason: 'workspace-switch' as const,
        endReason: 'timeout' as const,
      },
      summaryObservationIds: [33 as never],
    }
    const detour = {
      id: EpisodeId('bridge-url'),
      startedAtMs: 2_500,
      endedAtMs: 4_500,
      boundary: {
        startReason: 'first-observation' as const,
        endReason: 'workspace-switch' as const,
      },
      summaryKind: base.summaryKind,
      summary: base.summary,
      summaryObservationIds: [22 as never],
      resources: [{
        kind: 'url' as const,
        canonicalUri: 'https://docs.example/bridge',
        displayLabel: 'bridge docs',
        firstSeenAtMs: 2_500,
        lastSeenAtMs: 4_500,
        observationCount: 2,
      }],
      surfaces: [{
        bundleId: 'com.google.Chrome',
        surfaceKind: 'browser' as const,
        firstSeenAtMs: 2_500,
        lastSeenAtMs: 4_500,
        observationCount: 2,
      }],
      confidence: base.confidence,
      state: base.state,
    }

    const bridge = buildUrlDetourBridge(
      [previous, anchorEpisode],
      [previous, detour, anchorEpisode],
      anchorEpisode.id,
    )

    expect(bridge).toMatchObject({
      episodeId: detour.id,
      evidenceObservationIds: [22],
      referenceResources: [{
        canonicalUri: 'https://docs.example/bridge',
        displayLabel: 'bridge docs',
      }],
    })

    const blocker = {
      ...detour,
      id: EpisodeId('bridge-blocker'),
      startedAtMs: 3_000,
      endedAtMs: 3_500,
      summaryObservationIds: [23 as never],
    }
    expect(buildUrlDetourBridge(
      [previous, anchorEpisode],
      [previous, detour, blocker, anchorEpisode],
      anchorEpisode.id,
    )).toBeUndefined()

    expect(buildUrlDetourBridge(
      [previous, {
        ...anchorEpisode,
        boundary: {
          startReason: 'timeout' as const,
          endReason: 'timeout' as const,
        },
      }],
      [previous, detour, anchorEpisode],
      anchorEpisode.id,
    )).toBeUndefined()
  })

  it('keeps ambiguity compact instead of exposing whole episodes', () => {
    const resolution = resolveResume(resumeEpisodes, {
      query: '继续 provider.ts',
      nowMs: 10_000,
      turn: 1,
      source: 'tool',
    })
    const handoff = buildResumeHandoff(resolution)

    expect(handoff.status).toBe('ambiguous')
    if (handoff.status !== 'ambiguous') throw new Error('expected ambiguity')

    expect(handoff.candidates).toHaveLength(2)
    expect(handoff.candidates.map(candidate => candidate.workspace?.id).toSorted())
      .toEqual(['alpha', 'beta'])
    expect(handoff.candidates[0]).not.toHaveProperty('summary')
    expect(handoff.candidates[0]).not.toHaveProperty('resources')
  })
  it('attaches only a recent checkpoint that truly precedes the external work', () => {
    const resolution = resolveResume(resumeEpisodes, {
      query: '继续 server.ts',
      nowMs: 10_000,
      turn: 1,
      source: 'tool',
    })
    const handoff = buildResumeHandoff(resolution)
    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')

    const base = {
      sessionId: 'session-a',
      turn: 2,
      cwd: '/gamma',
      workspace: { id: 'gamma', root: '/gamma', title: 'gamma' },
      expiresAtMs: handoff.startedAtMs + 100_000,
    }
    const valid = { ...base, checkpointAtMs: handoff.startedAtMs - 1_000 }
    const future = { ...base, checkpointAtMs: handoff.startedAtMs + 1 }
    const stale = {
      ...base,
      checkpointAtMs: handoff.startedAtMs - (24 * 60 * 60 * 1_000) - 1,
    }

    expect(attachDshCheckpoint(handoff, valid).status).toBe('hit')
    const attached = attachDshCheckpoint(handoff, valid)
    expect(attached.status === 'hit' ? attached.checkpoint?.sessionId : undefined)
      .toBe('session-a')
    const futureResult = attachDshCheckpoint(handoff, future)
    expect(futureResult.status === 'hit' ? futureResult.checkpoint : undefined).toBeUndefined()
    const staleResult = attachDshCheckpoint(handoff, stale)
    expect(staleResult.status === 'hit' ? staleResult.checkpoint : undefined).toBeUndefined()
  })

})
