import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, {
  LlmAdapter, ToolCallId, createUserMessage,
  type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAgentIntegration } from '../../src/agent/integration.js'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

class HistoryQueryFixtureModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      const id = ToolCallId('history-query-1')
      const name = 'computer_history_query'
      const args = JSON.stringify({
        resource_kind: 'url', since_date: '2026-10-09', until_date: '2026-10-10',
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: {
        type: 'tool-call', id, name, arguments: args,
      } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'I found a historical web resource, not its current contents.' }
      yield { type: 'block-end', index: 0, block: {
        type: 'text', text: 'I found a historical web resource, not its current contents.',
      } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

describe('DSH real Agent loop: AI-first History typed tool', () => {
  it('registers and executes a typed query, returning source evidence to the second model call', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Sessions)
    await ctx.plugin(Agents)
    await ctx.plugin(Llm)
    await ctx.plugin(Tools)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Projections)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 4 })

    const queries: unknown[] = []
    ctx.provide('computerHistory', {
      queryEvidence(request: unknown) {
        queries.push(request)
        return Promise.resolve({
          items: [{
            id: 'episode:fixture',
            startedAtMs: 1_000,
            endedAtMs: 2_000,
            resources: [{ kind: 'url', canonicalUri: 'https://example.org/guide',
              displayLabel: 'Example Guide', firstSeenAtMs: 1_000, lastSeenAtMs: 2_000, observationCount: 1 }],
            surfaces: [],
            summary: 'Metadata only',
            state: 'closed',
            summaryObservationIds: [1],
          }],
          hasMore: false,
          notesAccess: 'not-searched',
          caveat: 'Metadata only; verify current source.',
        })
      },
      recordDshCheckpoint() {},
      getState() { return { enabled: false, capture: 'stopped', accessibilityTrusted: false } },
    } as never)

    const model = new HistoryQueryFixtureModel()
    ctx.llm.registerAdapter(['fixture'], model)
    const disposeIntegration = registerAgentIntegration(ctx, false)
    const handle = await ctx.agents.create({
      sessionId: SessionId('session:history-query'),
      agentOptions: { provider: 'fixture', model: 'fixture' },
    })
    handle.agent.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '昨天看了哪些网页？' }],
    }))
    await handle.agent.whenIdle()

    expect(model.requests.length).toBe(2)
    expect(model.requests[0]?.tools?.some(tool => tool.name === 'computer_history_query')).toBe(true)
    expect(queries).toEqual([{
      resourceKind: 'url',
      sinceMs: new Date(2026, 9, 9).getTime(),
      untilMs: new Date(2026, 9, 10).getTime(),
    }])
    expect(JSON.stringify(model.requests[1]?.messages)).toContain('https://example.org/guide')
    const events = handle.agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'tool/call')).toBe(true)
    expect(JSON.stringify(events)).toContain('I found a historical web resource')
    disposeIntegration()
    await handle.dispose()
  })
})
