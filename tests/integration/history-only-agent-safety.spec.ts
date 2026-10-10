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
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { registerHistoryEvidenceQueryTool } from '../../src/agent/tools.js'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

type Step = { name: string; args: Record<string, unknown> } | string

class RestrictedFixtureModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  public constructor(private readonly steps: readonly Step[]) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length > 8) throw new Error('test model turn budget exceeded')
    const step = this.steps[this.requests.length - 1] ?? 'Insufficient evidence'
    if (typeof step === 'string') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: step }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: step } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const id = ToolCallId('restricted-tool-' + this.requests.length)
    const args = JSON.stringify(step.args)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: step.name, argumentsDelta: args }
    yield {
      type: 'block-end', index: 0,
      block: { type: 'tool-call', id, name: step.name, arguments: args },
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

function syntheticEpisode() {
  return {
    id: 'synthetic-cad-001',
    startedAtMs: 1_000,
    endedAtMs: 2_000,
    state: 'closed',
    summary: 'Synthetic CAD work history only',
    summaryObservationIds: [] as number[],
    workspace: { id: 'QA-project', title: 'Synthetic Robot Arm' },
    resources: [{
      kind: 'file',
      canonicalUri: 'file:///synthetic/robot-arm/model.step',
      displayLabel: 'model.step',
      firstSeenAtMs: 1_000, lastSeenAtMs: 2_000, observationCount: 1,
    }],
    changedResources: [] as unknown[],
    surfaces: [] as unknown[],
    verifications: [] as unknown[],
  }
}

async function run(
  steps: readonly Step[],
  maxEvidenceCalls = 3,
  withAccidentalGenericTool = false,
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Sessions)
  await ctx.plugin(Agents)
  await ctx.plugin(Llm)
  await ctx.plugin(Tools)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  const queries: unknown[] = []
  ctx.provide('computerHistory', {
    async queryEvidence(request: unknown) {
      if (queries.length >= maxEvidenceCalls) {
        throw new Error('synthetic history query budget exceeded')
      }
      queries.push(request)
      return {
        items: [syntheticEpisode()], hasMore: false,
        notesAccess: 'not-searched',
        caveat: 'SYNTHETIC ONLY: no live file contents or current-state proof',
      }
    },
  } as never)
  const genericExecuted: string[] = []
  if (withAccidentalGenericTool) {
    ctx.tools.register(defineTool({
      name: 'bash',
      description: 'An accidentally registered unsafe shell',
      parameters: { command: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render: (_args, result) => [{ type: 'text', text: String(result) }],
      },
      execute: async (args) => {
        genericExecuted.push(args.command)
        return 'should never execute'
      },
    }))
  }
  const model = new RestrictedFixtureModel(steps)
  ctx.llm.registerAdapter(['restricted-fixture'], model)
  const handle = await ctx.agents.create({
    sessionId: SessionId('restricted-history-' + contexts.length),
    agentOptions: { provider: 'restricted-fixture', model: 'restricted-fixture' },
  })
  const unregister = registerHistoryEvidenceQueryTool(handle.agent.ctx)
  const exposed = ctx.tools.schemas(handle.agent).map(tool => tool.name)
  if (exposed.join() !== 'computer_history_query') {
    throw new Error('UNSAFE evaluation environment: unexpected tools: ' + exposed.join())
  }
  // Monotonic guard: new tools registered after preflight cannot become
  // executable merely because an agent fabricates a call.
  const releaseGuard = handle.agent.ctx.tools.guard(
    exec => exec.name === 'computer_history_query'
      ? undefined : 'History QA allowlist denied unrelated tool dispatch',
  )
  handle.agent.followup(createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Find historical work in a synthetic CAD project' }],
  }))
  await handle.agent.whenIdle()
  const events = handle.agent.session.snapshotEvents()
  const firstTools = model.requests[0]?.tools?.map(tool => tool.name) ?? []
  releaseGuard()
  unregister()
  await handle.dispose()
  return { queries, model, events, firstTools, genericExecuted }
}

describe('fail-closed DSH History-only evaluation harness', () => {
  it('advertises exactly one evidence tool, and can ground an allowed model call', async () => {
    const result = await run([
      { name: 'computer_history_query', args: { resource_kind: 'file' } },
      'Historical synthetic STEP file found; not proof of current state.',
    ])
    expect(result.firstTools).toEqual(['computer_history_query'])
    expect(result.queries).toEqual([{ resourceKind: 'file' }])
    expect(JSON.stringify(result.model.requests[1]?.messages))
      .toContain('file:///synthetic/robot-arm/model.step')
    expect(JSON.stringify(result.events)).toContain('Historical synthetic STEP file')
  })

  it('does NOT execute an invented bash command even when a model fabricates the call', async () => {
    const result = await run([
      { name: 'bash', args: { command: 'echo MUST_NOT_EXECUTE' } },
      'That tool is unavailable.',
    ])
    expect(result.firstTools).toEqual(['computer_history_query'])
    expect(result.queries).toHaveLength(0)
    expect(JSON.stringify(result.events)).not.toContain('MUST_NOT_EXECUTE\n')
  })

  it('fails preflight BEFORE sending any model turn if another tool is registered', async () => {
    await expect(run([
      { name: 'computer_history_query', args: { resource_kind: 'url' } },
    ], 3, true)).rejects.toThrow(/UNSAFE evaluation environment/)
  })

  it('allows separate queries for a compound question without enabling other tools', async () => {
    const result = await run([
      { name: 'computer_history_query', args: { event_kind: 'save' } },
      { name: 'computer_history_query', args: { event_kind: 'test' } },
      'Synthetic saved work and test history are evidence leads, not current proof.',
    ])
    expect(result.model.requests.length).toBe(3)
    expect(result.model.requests.every(request =>
      (request.tools ?? []).map(tool => tool.name).join() === 'computer_history_query',
    )).toBe(true)
    expect(result.queries).toEqual([
      { eventKind: 'save' }, { eventKind: 'test' },
    ])
  })

  it('enforces a backend budget even if the model repeatedly calls the permitted query', async () => {
    const result = await run([
      { name: 'computer_history_query', args: { resource_kind: 'file' } },
      { name: 'computer_history_query', args: { resource_kind: 'url' } },
      { name: 'computer_history_query', args: { event_kind: 'save' } },
      { name: 'computer_history_query', args: { event_kind: 'test' } },
      'Budget reached; do not claim the search was exhaustive.',
    ], 3)
    expect(result.firstTools).toEqual(['computer_history_query'])
    expect(result.queries).toHaveLength(3)
    expect(JSON.stringify(result.events)).toContain('synthetic history query budget exceeded')
  })
})
