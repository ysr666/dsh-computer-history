import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { registerExperimentalResumeHint } from '../../src/agent/index.js'

type Handler = (...args: any[]) => any

class Events {
  private readonly handlers = new Map<string, Handler[]>()

  public on(name: string, handler: Handler): () => void {
    const values = this.handlers.get(name) ?? []
    values.push(handler)
    this.handlers.set(name, values)
    return () => {
      const current = this.handlers.get(name) ?? []
      this.handlers.set(
        name,
        current.filter(value => value !== handler),
      )
    }
  }

  public current(name: string): readonly Handler[] {
    return this.handlers.get(name) ?? []
  }
}

function user(text: string) {
  return {
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  }
}
describe('experimental ResumeHint lifecycle', () => {
  it('cannot leak a stale claimed turn into the next turn', async () => {
    const rootEvents = new Events()
    const agentEvents = new Events()
    const requests: Array<{ query: string; turn: number }> = []
    const history = {
      resolveResume: async (request: {
        query: string
        turn: number
      }) => {
        requests.push({
          query: request.query,
          turn: request.turn,
        })
        return { status: 'none', reason: 'test' }
      },
    }

    const ctx = {
      on: rootEvents.on.bind(rootEvents),
      workspaceRegistry: {
        resolveByPath: async () => undefined,
      },
      // cordis inject-free accessor: the plugin provides computerHistory
      // itself, so `ctx.computerHistory` would throw on a real host.
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
    } as unknown as Context

    const agent = {
      ctx: { on: agentEvents.on.bind(agentEvents) },
      session: { header: {} },
    } as unknown as Agent

    const dispose = registerExperimentalResumeHint(ctx)
    const claimed = rootEvents.current('agent/inbox/claimed')[0]!
    claimed({
      agent,
      message: user('继续刚才的'),
      turn: 1,
    })
    expect(agentEvents.current('system-prompt/assemble')).toHaveLength(1)

    claimed({
      agent,
      message: user('继续刚才 VS Code 里的'),
      turn: 2,
    })
    expect(agentEvents.current('system-prompt/assemble')).toHaveLength(1)

    const assembly = { contexts: [] as Array<{ name: string; text: string }> }
    const assemble = agentEvents.current('system-prompt/assemble')[0]!
    await assemble(
      assembly,
      {},
      async () => undefined,
    )

    expect(requests).toEqual([{
      query: '继续刚才 VS Code 里的',
      turn: 2,
    }])
    expect(assembly.contexts).toEqual([])
    dispose()
  })
})
