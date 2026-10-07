import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, {
  LlmAdapter,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAgentIntegration } from '../../src/agent/integration.js'

class FixtureModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
    })
  }

  override async * stream(
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield {
      type: 'text-delta',
      index: 0,
      text: 'Continuation started without a history tool call.',
    }
    yield {
      type: 'block-end',
      index: 0,
      block: {
        type: 'text',
        text: 'Continuation started without a history tool call.',
      },
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(
    contexts.splice(0).map(context => context.fiber.dispose()),
  )
})

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)

  await ctx.plugin(Sessions)
  await ctx.plugin(Agents)
  await ctx.plugin(Llm)
  await ctx.plugin(Tools)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop, {
    agents: [],
    maxParallelToolCalls: 4,
  })

  const model = new FixtureModel()
  ctx.llm.registerAdapter(['fixture'], model)

  ctx.provide('computerHistory', {
    continuationEpisodeForSession(sessionId: string) {
      return sessionId === 'session:continue'
        ? 'episode:continue'
        : undefined
    },
    async getEpisode() {
      return {
        id: 'episode:continue',
        startedAtMs: 100,
        endedAtMs: 200,
        boundary: {
          startReason: 'first-observation',
          endReason: 'timeout',
        },
        threadKey: 'browser:https://example.test/work',
        summaryKind: 'deterministic',
        summary: 'SECRET SUMMARY MUST NOT ENTER THE BOOTSTRAP',
        summaryObservationIds: [1],
        lastStrongResource: {
          kind: 'url',
          canonicalUri: 'https://example.test/work',
          displayLabel: 'Current work page',
        },
        resources: [{
          kind: 'url',
          canonicalUri: 'https://example.test/work',
          displayLabel: 'Current work page',
          firstSeenAtMs: 100,
          lastSeenAtMs: 200,
          observationCount: 2,
        }],
        changedResources: [],
        verifications: [],
        surfaces: [{
          bundleId: 'com.google.Chrome',
          surfaceKind: 'browser',
          firstSeenAtMs: 100,
          lastSeenAtMs: 200,
          observationCount: 2,
        }],
        confidence: 0.9,
        state: 'closed',
        observationIds: [1],
      }
    },
    latestDshCheckpoint() {
      return {
        sessionId: 'session:previous',
        turn: 4,
        checkpointAtMs: 90,
      }
    },
    async thread() {
      return undefined
    },
    async recent() {
      return []
    },
    getState() {
      return {
        enabled: false,
        capture: 'stopped',
        accessibilityTrusted: false,
      }
    },
    recordDshCheckpoint() {},
  } as never)

  ctx.provide('sessionQuery', {
    async readSurface(sessionId: string) {
      expect(sessionId).toBe('session:previous')
      return {
        session: {},
        inheritedEventCount: 0,
        capturedThroughSeq: 2,
        events: [
          {
            type: 'user/message',
            data: {
              source: { kind: 'user' },
              content: [{
                type: 'text',
                text: 'Keep polishing the native Continue workflow.',
              }],
            },
          },
          {
            type: 'assistant/message',
            data: {
              message: {
                content: [{
                  type: 'text',
                  text: 'The capsule is done; next make the resume path deterministic.',
                }],
              },
            },
          },
        ],
      }
    },
  } as never)

  const disposeIntegration = registerAgentIntegration(ctx, false)
  return { ctx, model, disposeIntegration }
}

describe('native Continue send loop', () => {
  it('puts the bounded bootstrap in the first real model request without requiring the history tool', async () => {
    const { ctx, model, disposeIntegration } = await harness()
    const handle = await ctx.agents.create({
      sessionId: SessionId('session:continue'),
      agentOptions: {
        provider: 'fixture',
        model: 'fixture',
      },
    })

    handle.agent.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '@"Computer History"' }],
    }))
    await handle.agent.whenIdle()

    expect(model.requests).toHaveLength(1)
    const request = model.requests[0]!
    const serializedMessages = JSON.stringify(request.messages)
    const continueTool = request.tools?.find(
      tool => tool.name === 'computer_history_continue',
    )
    const bootstrapText = continueTool?.description ?? ''
    const serializedRequest = JSON.stringify({
      messages: request.messages,
      tools: request.tools,
    })

    expect(bootstrapText.length).toBeLessThan(12_000)
    expect(bootstrapText).toContain('## Computer History Continue')
    expect(bootstrapText).toContain(
      'Keep polishing the native Continue workflow.',
    )
    expect(bootstrapText).toContain('https://example.test/work')
    expect(bootstrapText).toContain('make concrete progress')
    expect(serializedMessages).not.toContain('## Computer History Continue')
    const directUser = request.messages.find(message => message.role === 'user')
    expect(directUser?.content).toEqual([
      { type: 'text', text: '@"Computer History"' },
    ])

    expect(serializedRequest).not.toContain('episode:continue')
    expect(serializedRequest).not.toContain('session:previous')
    expect(serializedRequest).not.toContain(
      'SECRET SUMMARY MUST NOT ENTER THE BOOTSTRAP',
    )
    expect(serializedRequest).not.toContain('evidenceObservationIds')

    expect(continueTool).toBeDefined()

    const events = handle.agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'tool/call')).toBe(false)
    expect(JSON.stringify(events))
      .toContain('Continuation started without a history tool call.')

    disposeIntegration()
    await handle.dispose()
  })
})
