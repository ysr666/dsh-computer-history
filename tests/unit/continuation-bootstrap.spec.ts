import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  buildContinuationBootstrap,
  projectPriorTaskContext,
  renderContinuationBootstrap,
} from '../../src/agent/continuation-bootstrap.js'
import type { ResumeHandoff } from '../../src/shared/index.js'

function handoff(): Extract<ResumeHandoff, { status: 'hit' }> {
  return {
    status: 'hit',
    episodeId: 'episode:bootstrap' as never,
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
    recentResources: [],
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
    confidence: 0.9,
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
      sessionId: 'session:previous',
      turn: 8,
      checkpointAtMs: 90,
      gitHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  }
}

describe('ContinuationBootstrap', () => {
  it('projects only bounded direct user/assistant text from the prior DSH surface', async () => {
    const ctx = {
      get(name: string) {
        if (name !== 'sessionQuery') return undefined
        return {
          async readSurface() {
            return {
              events: [
                {
                  type: 'user/message',
                  data: {
                    source: { kind: 'user' },
                    content: [{ type: 'text', text: 'Implement the native Continue capsule.' }],
                  },
                },
                {
                  type: 'user/message',
                  data: {
                    source: { kind: 'plugin', plugin: 'time-context' },
                    content: [{ type: 'text', text: 'hidden runtime context' }],
                  },
                },
                {
                  type: 'assistant/message',
                  data: {
                    message: {
                      content: [
                        { type: 'reasoning', text: 'private reasoning must not project' },
                        { type: 'text', text: 'The capsule UI is done; next make continuation deterministic.' },
                      ],
                    },
                  },
                },
                {
                  type: 'tool/result',
                  data: {
                    message: {
                      content: [{ type: 'text', text: 'tool output must not project' }],
                    },
                  },
                },
              ],
            }
          },
        }
      },
    } as unknown as Context

    await expect(projectPriorTaskContext(
      ctx,
      'session:previous',
    )).resolves.toEqual([
      {
        role: 'user',
        text: 'Implement the native Continue capsule.',
      },
      {
        role: 'assistant',
        text: 'The capsule UI is done; next make continuation deterministic.',
      },
    ])
  })

  it('keeps the latest real user task even when later assistant steps would otherwise crowd it out', async () => {
    const ctx = {
      get(name: string) {
        if (name !== 'sessionQuery') return undefined
        return {
          async readSurface() {
            return {
              events: [
                {
                  type: 'user/message',
                  data: {
                    source: { kind: 'user' },
                    content: [{
                      type: 'text',
                      text: 'Fix the continuation verification path.',
                    }],
                  },
                },
                ...Array.from({ length: 5 }, (_, index) => ({
                  type: 'assistant/message',
                  data: {
                    message: {
                      content: [{
                        type: 'text',
                        text: 'assistant progress ' + String(index + 1),
                      }],
                    },
                  },
                })),
              ],
            }
          },
        }
      },
    } as unknown as Context

    const items = await projectPriorTaskContext(ctx, 'session:previous')
    expect(items).toHaveLength(4)
    expect(items[0]).toEqual({
      role: 'user',
      text: 'Fix the continuation verification path.',
    })
    expect(items.slice(1).map(item => item.text)).toEqual([
      'assistant progress 3',
      'assistant progress 4',
      'assistant progress 5',
    ])
  })

  it('strips an older Continue marker instead of recursively projecting the capsule itself', async () => {
    const ctx = {
      get(name: string) {
        if (name !== 'sessionQuery') return undefined
        return {
          async readSurface() {
            return {
              events: [
                {
                  type: 'user/message',
                  data: {
                    source: { kind: 'user' },
                    content: [{
                      type: 'text',
                      text: 'Keep working on the handoff.',
                    }],
                  },
                },
                {
                  type: 'user/message',
                  data: {
                    source: { kind: 'user' },
                    content: [{
                      type: 'text',
                      text: '@"Computer History"',
                    }],
                  },
                },
                {
                  type: 'assistant/message',
                  data: {
                    message: {
                      content: [{
                        type: 'text',
                        text: 'I continued the handoff work.',
                      }],
                    },
                  },
                },
              ],
            }
          },
        }
      },
    } as unknown as Context

    await expect(projectPriorTaskContext(
      ctx,
      'session:previous',
    )).resolves.toEqual([
      { role: 'user', text: 'Keep working on the handoff.' },
      { role: 'assistant', text: 'I continued the handoff work.' },
    ])
  })

  it('injects only the bounded bootstrap, not the full handoff or Episode identity', async () => {
    const ctx = {
      get(name: string) {
        if (name !== 'sessionQuery') return undefined
        return {
          async readSurface() {
            return {
              events: [{
                type: 'user/message',
                data: {
                  source: { kind: 'user' },
                  content: [{ type: 'text', text: 'Continue the same UI work.' }],
                },
              }],
            }
          },
        }
      },
    } as unknown as Context

    const bootstrap = await buildContinuationBootstrap(ctx, handoff())
    expect(bootstrap).toMatchObject({
      version: 1,
      taskContext: {
        status: 'available',
        items: [{ role: 'user', text: 'Continue the same UI work.' }],
      },
      workState: {
        workspace: { title: 'demo', root: '/repo/demo' },
        repository: {
          state: 'dirty',
          headSinceCheckpoint: 'changed',
        },
        priorityTargets: [{
          locator: 'file:///repo/demo/src/main.ts',
        }],
        verification: {
          status: 'observed-success',
          recommendedNext: 're-run-after-current-state-inspection',
        },
      },
    })
    const text = renderContinuationBootstrap(bootstrap!)
    expect(text).toContain('Follow workState.firstPass')
    expect(text).toContain('computer_history_continue')
    expect(text).toContain('is not required before starting')
    expect(text).not.toContain('episode:bootstrap')
    expect(text).not.toContain('session:previous')
    expect(text).not.toContain('evidenceObservationIds')
    expect(text).not.toContain('recent-episode')
  })

  it('bounds labels, locators, and workspace identity in the automatic bootstrap', async () => {
    const huge = 'x'.repeat(12_000)
    const source = handoff()
    const oversized = {
      ...source,
      workspace: {
        ...source.workspace,
        title: huge,
        root: '/' + huge,
      },
      lastActiveResource: {
        kind: 'url',
        canonicalUri: 'https://example.test/' + huge,
        displayLabel: huge,
      },
      changedResources: [],
      referenceResources: [{
        kind: 'url',
        canonicalUri: 'https://example.test/' + huge,
        displayLabel: huge,
      }],
      git: undefined,
    } as unknown as Extract<ResumeHandoff, { status: 'hit' }>

    const bootstrap = await buildContinuationBootstrap(
      { get: () => undefined } as unknown as Context,
      oversized,
    )
    const rendered = renderContinuationBootstrap(bootstrap!)

    expect(bootstrap?.workState.workspace?.title?.length)
      .toBeLessThanOrEqual(240)
    expect(bootstrap?.workState.workspace?.root).toBeUndefined()
    expect(bootstrap?.workState.referenceTargets).toEqual([])
    expect(bootstrap?.workState.firstPass.some(step =>
      (step.target?.length ?? 0) > 2_048,
    )).toBe(false)
    expect(rendered.length).toBeLessThan(12_000)
  })

  it('does not auto-project task text from a checkpoint more than ten minutes before the Episode', async () => {
    const source = handoff()
    const stale = {
      ...source,
      startedAtMs: 1_000_000,
      checkpoint: {
        ...source.checkpoint!,
        checkpointAtMs: 1_000_000 - (10 * 60 * 1_000) - 1,
      },
    } as Extract<ResumeHandoff, { status: 'hit' }>

    const ctx = {
      get(name: string) {
        if (name !== 'sessionQuery') return undefined
        return {
          async readSurface() {
            throw new Error('stale checkpoint must not be queried')
          },
        }
      },
    } as unknown as Context

    const bootstrap = await buildContinuationBootstrap(ctx, stale)
    expect(bootstrap?.taskContext).toEqual({
      status: 'unavailable',
      items: [],
    })
  })

  it('caps historical text and does not block bootstrap when prior session is unavailable', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    const bootstrap = await buildContinuationBootstrap(ctx, handoff())
    expect(bootstrap?.taskContext).toEqual({
      status: 'unavailable',
      items: [],
    })
    expect(bootstrap?.workState.firstPass.at(-1)?.action)
      .toBe('make-concrete-progress')
  })
})
