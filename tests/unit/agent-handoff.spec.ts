import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { buildAgentResumeHandoff, buildAgentResumeHandoffFromEpisode } from '../../src/agent/handoff.js'
import { resolveResume } from '../../src/host/resume/index.js'
import { resumeEpisodes } from '../fixtures/resume-episodes.js'

describe('Agent resume handoff enrichment', () => {
  it('links the latest same-workspace DSH boundary before external work began', async () => {
    let request: Record<string, unknown> | undefined
    const history = {
      latestDshCheckpoint(value: Record<string, unknown>) {
        request = value
        return {
          sessionId: 'session-before',
          turn: 4,
          checkpointAtMs: 2_500,
          workspace: { id: 'gamma', root: '/gamma', title: 'gamma' },
        }
      },
    }
    const ctx = {
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
      subprocess: {
        spawn() { throw new Error('no git in this unit') },
      },
    } as unknown as Context

    const resolution = resolveResume(resumeEpisodes, {
      query: '继续 server.ts',
      nowMs: 10_000,
      turn: 1,
      source: 'tool',
    })
    const handoff = await buildAgentResumeHandoff(ctx, resolution)

    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')
    expect(request).toEqual({
      workspaceId: 'gamma',
      workspaceRoot: '/gamma',
      atOrBeforeMs: 3_000,
    })
    expect(handoff.checkpoint).toMatchObject({
      sessionId: 'session-before',
      turn: 4,
    })
  })

  it('adds a bounded prior same-thread tail only for explicit Episode continuation', async () => {
    const anchor = resumeEpisodes[2]!
    const prior = {
      ...anchor,
      id: 'gamma-prior' as typeof anchor.id,
      startedAtMs: 1_500,
      endedAtMs: 2_500,
      summaryObservationIds: [77 as never],
      resources: [{
        kind: 'file' as const,
        canonicalUri: 'file:///gamma/src/prior.ts',
        displayLabel: 'prior.ts',
        firstSeenAtMs: 1_500,
        lastSeenAtMs: 2_500,
        observationCount: 1,
      }],
    }
    let threadRequest: unknown
    const history = {
      async getEpisode() { return anchor },
      latestDshCheckpoint() { return undefined },
      async thread(request: unknown) {
        threadRequest = request
        return {
          thread: {
            threadKey: anchor.threadKey!,
            episodeIds: [prior.id, anchor.id],
            episodeCount: 2,
            activityCount: 2,
            approxActiveDurationMs: 2_000,
            startedAtMs: prior.startedAtMs,
            endedAtMs: anchor.endedAtMs,
            resources: [],
            summary: '',
            summaryObservationIds: [77 as never, 1 as never],
          },
          timeline: [{
            dayKey: '1970-01-01',
            episodeCount: 2,
            episodes: [prior, anchor],
            activityCount: 0,
            activities: [],
            startedAtMs: prior.startedAtMs,
            endedAtMs: anchor.endedAtMs,
          }],
        }
      },
    }
    const ctx = {
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
      subprocess: {
        spawn() { throw new Error('no git in this unit') },
      },
    } as unknown as Context

    const handoff = await buildAgentResumeHandoffFromEpisode(ctx, anchor.id)

    expect(threadRequest).toEqual({ threadKey: 'workspace:gamma' })
    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')
    expect(handoff.priorThreadTail?.episodeIds).toEqual([prior.id])
    expect(handoff.priorThreadTail?.recentResources).toEqual([
      expect.objectContaining({ displayLabel: 'prior.ts' }),
    ])
  })

  it('adds one closed-loop URL browser detour as lower-priority explicit reference evidence', async () => {
    const base = resumeEpisodes[2]!
    const prior = {
      ...base,
      id: 'gamma-before-browser' as typeof base.id,
      startedAtMs: 1_000,
      endedAtMs: 2_000,
      boundary: {
        startReason: 'first-observation' as const,
        endReason: 'workspace-switch' as const,
      },
      summaryObservationIds: [70 as never],
    }
    const anchorEpisode = {
      ...base,
      id: 'gamma-after-browser' as typeof base.id,
      startedAtMs: 5_000,
      endedAtMs: 6_000,
      boundary: {
        startReason: 'workspace-switch' as const,
        endReason: 'timeout' as const,
      },
      summaryObservationIds: [90 as never],
    }
    const detour = {
      id: 'browser-detour' as typeof base.id,
      startedAtMs: 2_500,
      endedAtMs: 4_500,
      boundary: {
        startReason: 'first-observation' as const,
        endReason: 'workspace-switch' as const,
      },
      summaryKind: base.summaryKind,
      summary: base.summary,
      summaryObservationIds: [80 as never],
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
    const history = {
      async getEpisode() { return anchorEpisode },
      latestDshCheckpoint() { return undefined },
      async thread() {
        return {
          thread: {
            threadKey: anchorEpisode.threadKey!,
            episodeIds: [prior.id, anchorEpisode.id],
            episodeCount: 2,
            activityCount: 2,
            approxActiveDurationMs: 2_000,
            startedAtMs: prior.startedAtMs,
            endedAtMs: anchorEpisode.endedAtMs,
            resources: [],
            summary: '',
            summaryObservationIds: [70 as never, 90 as never],
          },
          timeline: [{
            dayKey: '1970-01-01',
            episodeCount: 2,
            episodes: [prior, anchorEpisode],
            activityCount: 0,
            activities: [],
            startedAtMs: prior.startedAtMs,
            endedAtMs: anchorEpisode.endedAtMs,
          }],
        }
      },
      async recent() { return [prior, detour, anchorEpisode] },
    }
    const ctx = {
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
      subprocess: {
        spawn() { throw new Error('no git in this unit') },
      },
    } as unknown as Context

    const handoff = await buildAgentResumeHandoffFromEpisode(
      ctx,
      anchorEpisode.id,
    )

    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')
    expect(handoff.priorThreadTail?.episodeIds).toEqual([prior.id])
    expect(handoff.urlDetourBridge).toMatchObject({
      episodeId: detour.id,
      referenceResources: [{
        displayLabel: 'bridge docs',
      }],
      evidenceObservationIds: [80],
    })
  })

  it('does not claim continuity from a stale checkpoint more than a day old', async () => {
    const history = {
      latestDshCheckpoint() {
        return {
          sessionId: 'session-stale',
          turn: 2,
          checkpointAtMs: 3_000 - (24 * 60 * 60 * 1_000) - 1,
          workspace: { id: 'gamma', root: '/gamma', title: 'gamma' },
        }
      },
    }
    const ctx = {
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
      subprocess: {
        spawn() { throw new Error('no git in this unit') },
      },
    } as unknown as Context

    const resolution = resolveResume(resumeEpisodes, {
      query: '继续 server.ts',
      nowMs: 10_000,
      turn: 1,
      source: 'tool',
    })
    const handoff = await buildAgentResumeHandoff(ctx, resolution)
    expect(handoff.status).toBe('hit')
    if (handoff.status !== 'hit') throw new Error('expected hit')
    expect(handoff.checkpoint).toBeUndefined()
  })
})
