import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { registerComputerHistoryContinueRouting } from '../../src/agent/index.js'

type Handler = (...args: any[]) => any

class Events {
  private readonly handlers = new Map<string, Handler[]>()

  public on(name: string, handler: Handler): () => void {
    const values = this.handlers.get(name) ?? []
    values.push(handler)
    this.handlers.set(name, values)
    return () => {
      this.handlers.set(
        name,
        (this.handlers.get(name) ?? []).filter(value => value !== handler),
      )
    }
  }

  public current(name: string): readonly Handler[] {
    return this.handlers.get(name) ?? []
  }
}

function episode() {
  return {
    id: 'episode:bound',
    startedAtMs: 10,
    endedAtMs: 20,
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    summaryKind: 'deterministic',
    summary: 'must not enter bootstrap',
    resources: [{
      kind: 'url',
      canonicalUri: 'https://example.test/current',
      displayLabel: 'Current page',
      firstSeenAtMs: 10,
      lastSeenAtMs: 20,
      observationCount: 1,
    }],
    referenceResources: [{
      kind: 'url',
      canonicalUri: 'https://example.test/current',
      displayLabel: 'Current page',
    }],
    changedResources: [],
    verifications: [],
    surfaces: [],
    confidence: 0.9,
    state: 'closed',
    observationIds: [1],
    summaryObservationIds: [1],
  }
}

function boundAgent(
  agentEvents: Events,
  history: Record<string, unknown>,
  sessionId = 'session:new',
): Agent {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
  ]
  return {
    ctx: {
      on: agentEvents.on.bind(agentEvents),
      get(name: string) {
        if (name === 'computerHistory') return history
        return undefined
      },
    },
    session: {
      id: sessionId,
      snapshotEvents: () => events,
    },
  } as unknown as Agent
}

describe('native Continue bootstrap', () => {
  it('injects a bounded system section from the standing assembly seam without requiring an inbox event', async () => {
    const agentEvents = new Events()
    const history = {
      continuationEpisodeForSession(sessionId: string) {
        return sessionId === 'session:new' ? 'episode:bound' : undefined
      },
      unbindContinuationSession() { return true },
      async getEpisode() { return episode() },
      latestDshCheckpoint() { return undefined },
    }
    const agent = boundAgent(agentEvents, history)
    const ctx = {
      get(name: string) {
        if (name === 'computerHistory') return history
        return undefined
      },
    } as unknown as Context
    const dispose = registerComputerHistoryContinueRouting(ctx, agent)

    expect(agentEvents.current('system-prompt/assemble')).toHaveLength(1)
    const assembly = {
      sections: [
        { name: 'test:complete', text: 'Locked persona.' },
      ],
      contexts: [],
      tools: [{
        name: 'computer_history_continue',
        description: 'Base deep-history tool.',
        parameters: {},
      }],
      variables: {},
    }
    const result = await agentEvents.current('system-prompt/assemble')[0]?.(
      assembly,
      { signal: new AbortController().signal },
      async () => assembly,
    )

    const tool = result.tools.find(
      (item: { name: string }) =>
        item.name === 'computer_history_continue',
    )
    expect(tool).toBeDefined()
    expect(tool.description).toContain(
      'Automatic Computer History Continue attachment',
    )
    expect(tool.description).toContain('The user explicitly selected')
    expect(tool.description).toContain('https://example.test/current')
    expect(tool.description).not.toContain('episode:bound')
    expect(tool.description).not.toContain('must not enter bootstrap')

    const secondAssembly = {
      sections: [{ name: 'test:complete', text: 'Locked persona.' }],
      contexts: [],
      tools: [{
        name: 'computer_history_continue',
        description: 'Base deep-history tool.',
        parameters: {},
      }],
      variables: {},
    }
    const second = await agentEvents.current('system-prompt/assemble')[0]?.(
      secondAssembly,
      { signal: new AbortController().signal },
      async () => secondAssembly,
    )
    expect(second.tools.find(
      (item: { name: string }) =>
        item.name === 'computer_history_continue',
    )?.description).toContain(
      'Automatic Computer History Continue attachment',
    )

    agentEvents.current('agent/turn-stopping')[0]?.({
      agent,
      turn: 1,
      signal: new AbortController().signal,
    })
    expect(history.continuationEpisodeForSession('session:new'))
      .toBe('episode:bound')
    dispose()
  })

  it('does not inject for an unbound session even if its user text could look like the capsule', async () => {
    const agentEvents = new Events()
    const history = {
      continuationEpisodeForSession: () => undefined,
      unbindContinuationSession: () => false,
    }
    const agent = boundAgent(agentEvents, history, 'session:unbound')
    const ctx = {
      get(name: string) {
        if (name === 'computerHistory') return history
        return undefined
      },
    } as unknown as Context
    const dispose = registerComputerHistoryContinueRouting(ctx, agent)

    const assembly = {
      sections: [{ name: 'test:complete', text: 'Locked persona.' }],
      contexts: [],
      tools: [{
        name: 'computer_history_continue',
        description: 'Base deep-history tool.',
        parameters: {},
      }],
      variables: {},
    }
    const result = await agentEvents.current('system-prompt/assemble')[0]?.(
      assembly,
      { signal: new AbortController().signal },
      async () => assembly,
    )
    expect(result.tools.find(
      (item: { name: string }) =>
        item.name === 'computer_history_continue',
    )?.description).toBe('Base deep-history tool.')
    dispose()
  })

  it('consumes the exact continuation binding when the continuation turn stops', async () => {
    const agentEvents = new Events()
    let bound = true
    const history = {
      continuationEpisodeForSession() {
        return bound ? 'episode:bound' : undefined
      },
      unbindContinuationSession() {
        const previous = bound
        bound = false
        return previous
      },
      async getEpisode() { return episode() },
      latestDshCheckpoint() { return undefined },
    }
    const agent = boundAgent(agentEvents, history)
    const ctx = {
      get(name: string) {
        if (name === 'computerHistory') return history
        return undefined
      },
    } as unknown as Context
    const dispose = registerComputerHistoryContinueRouting(ctx, agent)
    const assembly = {
      sections: [{ name: 'test:complete', text: 'Locked persona.' }],
      contexts: [],
      tools: [{
        name: 'computer_history_continue',
        description: 'Base deep-history tool.',
        parameters: {},
      }],
      variables: {},
    }
    await agentEvents.current('system-prompt/assemble')[0]?.(
      assembly,
      { signal: new AbortController().signal },
      async () => assembly,
    )
    agentEvents.current('agent/turn-stopping')[0]?.({
      agent,
      turn: 1,
      signal: new AbortController().signal,
    })
    expect(bound).toBe(false)
    dispose()
  })
})
