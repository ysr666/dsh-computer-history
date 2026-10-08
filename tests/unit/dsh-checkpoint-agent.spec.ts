import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { registerDshCheckpoints } from '../../src/agent/checkpoint.js'

class Events {
  private readonly handlers = new Map<string, Array<(...args: any[]) => any>>()

  public on(name: string, handler: (...args: any[]) => any): () => void {
    const values = this.handlers.get(name) ?? []
    values.push(handler)
    this.handlers.set(name, values)
    return () => {
      this.handlers.set(name, (this.handlers.get(name) ?? []).filter(item => item !== handler))
    }
  }

  public first(name: string): ((...args: any[]) => any) | undefined {
    return this.handlers.get(name)?.[0]
  }

  public count(name: string): number {
    return this.handlers.get(name)?.length ?? 0
  }
}

describe('DSH continuity checkpoints', () => {
  it('records only metadata at a top-level turn boundary', async () => {
    const events = new Events()
    const recorded: unknown[] = []
    const history = {
      getState() {
        return { enabled: true, capture: 'running' as const }
      },
      recordDshCheckpoint(value: unknown) {
        recorded.push(value)
        return value
      },
    }
    const ctx = {
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
      workspaceRegistry: {
        resolveByPath: async () => ({
          id: 'workspace-1',
          path: '/Users/test/project',
          title: 'project',
        }),
      },
      subprocess: {
        spawn: () => ({
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: {
              readFrom: () => ({
                text: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
                nextOffset: 41,
                lossy: false,
              }),
            },
          },
        }),
      },
    } as unknown as Context
    const agent = {
      ctx: { on: events.on.bind(events) },
      session: {
        id: 'session-1',
        header: {
          cwd: '/Users/test/project',
          origin: undefined,
        },
      },
    } as unknown as Agent

    const dispose = registerDshCheckpoints(ctx, agent, () => 123_456)
    await events.first('agent/turn-stopping')?.({ turn: 7 })

    expect(recorded).toEqual([{
      sessionId: 'session-1',
      turn: 7,
      checkpointAtMs: 123_456,
      cwd: '/Users/test/project',
      workspace: {
        id: 'workspace-1',
        root: '/Users/test/project',
        title: 'project',
      },
      gitHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }])
    expect(JSON.stringify(recorded)).not.toContain('message')
    expect(JSON.stringify(recorded)).not.toContain('assistant')
    dispose()
  })

  it('does not write while Computer History is paused', async () => {
    const events = new Events()
    const recorded: unknown[] = []
    const history = {
      getState() { return { enabled: true, capture: 'paused' as const } },
      recordDshCheckpoint(value: unknown) { recorded.push(value); return value },
    }
    const ctx = {
      get(name: string) { return name === 'computerHistory' ? history : undefined },
      workspaceRegistry: { resolveByPath: async () => undefined },
    } as unknown as Context
    const agent = {
      ctx: { on: events.on.bind(events) },
      session: { id: 'session-paused', header: { cwd: '/tmp/work' } },
    } as unknown as Agent

    const dispose = registerDshCheckpoints(ctx, agent, () => 99)
    await events.first('agent/turn-stopping')?.({ turn: 1 })
    expect(recorded).toEqual([])
    dispose()
  })

  it('does not register checkpoint capture for subagents', () => {
    const events = new Events()
    const ctx = {} as Context
    const agent = {
      ctx: { on: events.on.bind(events) },
      session: { header: { origin: 'subagent' } },
    } as unknown as Agent
    registerDshCheckpoints(ctx, agent)
    expect(events.count('agent/turn-stopping')).toBe(0)
  })
})
