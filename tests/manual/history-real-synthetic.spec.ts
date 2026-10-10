/**
 * Opt-in real-model / real DSH Agent Loop / real local SQLite test.
 * All History records here are synthetic. There are NO filesystem/bash tools
 * and no production history directories or credentials read by this module.
 *
 * Run ONLY with DCH_QA_LIVE=1 and DCH_QA_DEEPSEEK_KEY set. This is not a
 * production or CI test. Agent requests are preflighted before every API call.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
import { describe, expect, it } from 'vitest'
import { CollectorSessionId, EpisodeId, type ActivityObservation } from '../../src/shared/index.js'
import {
  EpisodeStore, ObservationStore, ResourceStore, openHistoryDatabase,
} from '../../src/host/store/index.js'
import { registerHistoryEvidenceQueryTool } from '../../src/agent/tools.js'
import { continueFromHistoryHit } from '../../src/client/ask-history-view.js'

const TEST_DATE = new Date(2026, 9, 10, 14).getTime()
const OCT9 = new Date(2026, 9, 9, 14).getTime()
const RUN = process.env.DCH_QA_LIVE === '1' && Boolean(process.env.DCH_QA_DEEPSEEK_KEY)
const ALLOWED_TOOL = 'computer_history_query'
const SYNTHETIC = 'SYNTHETIC_QA_ONLY'

type WireMessage = {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

function toWire(options: GenerateOptions): WireMessage[] {
  const result: WireMessage[] = []
  for (const message of options.messages) {
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const unexpected = message.content.filter(block => !['text', 'reasoning', 'tool-call'].includes(block.type))
    if (unexpected.length) throw new Error('QA blocked non-text/model-tools content')
    if (message.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: String(message.toolCallId), content: text })
    } else if (message.role === 'assistant') {
      const calls = message.content.filter(block => block.type === 'tool-call').map(block => ({
        id: String(block.id), type: 'function' as const,
        function: { name: block.name, arguments: block.arguments },
      }))
      result.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    } else if (message.role === 'developer') {
      // DSH tool-addition developer blocks are not needed by this simple model.
      if (text) result.push({ role: 'developer', content: text })
    } else if (message.role === 'system') {
      result.push({ role: 'system', content: text })
    } else {
      result.push({ role: 'user', content: text })
    }
  }
  return result
}

class RealRestrictedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly outputs: string[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.requests.length >= 5) throw new Error('QA max model turns reached')
    if (options.tools?.length !== 1 || options.tools[0]?.name !== ALLOWED_TOOL) {
      throw new Error('QA tool preflight failed: unexpected model tools')
    }
    const messages = toWire(options)
    const serialized = JSON.stringify(messages)
    if (/\/Users\/|\/home\/|\.dsh\/|ysradmin|\.credentials|api[_-]?key/i.test(serialized)) {
      throw new Error('QA request blocked: suspicious real-user path or credential')
    }
    this.requests.push(options)
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.DCH_QA_DEEPSEEK_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        tools: options.tools.map(tool => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
        tool_choice: 'auto', temperature: 0, max_tokens: 450, stream: false,
      }),
      signal: AbortSignal.timeout(18_000),
    })
    if (!response.ok) throw new Error('QA provider HTTP status ' + response.status)
    const responseBody = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      }>
    }
    const message = responseBody.choices?.[0]?.message
    if (!message) throw new Error('QA provider returned no assistant message')
    const calls = message.tool_calls ?? []
    if (calls.length) {
      for (const [index, call] of calls.entries()) {
        if (call.function.name !== ALLOWED_TOOL) throw new Error('QA provider requested forbidden tool')
        const id = ToolCallId(call.id)
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: call.function.name, argumentsDelta: call.function.arguments }
        yield { type: 'block-end', index,
          block: { type: 'tool-call', id, name: call.function.name, arguments: call.function.arguments } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const answer = message.content ?? ''
      this.outputs.push(answer)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: answer }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

describe.skipIf(!RUN)('manual: real model → DSH Agent → synthetic SQLite → grounded answer', () => {
  it('identifies an exact CAD Episode without inheriting any other tools', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dch-sixth-synthetic-'))
    const ctx = new Context()
    let closeDatabase: (() => void) | undefined
    try {
      await ctx.plugin(Sessions)
      await ctx.plugin(Agents)
      await ctx.plugin(Llm)
      await ctx.plugin(Tools)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(Projections)
      await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })

      const connection = openHistoryDatabase({ dataDirectory: path.join(root, 'history'), nowMs: TEST_DATE })
      closeDatabase = () => connection.close()
      const episodes = new EpisodeStore(connection.db)
      const observations = new ObservationStore(connection.db)
      const resources = new ResourceStore(connection.db)

      function seed(id: string, kind: 'file' | 'url', uri: string,
        app: string, workspace: string, time: number, event?: 'save' | 'verify-test-success') {
        const observation: ActivityObservation = {
          collectorSessionId: CollectorSessionId(SYNTHETIC),
          seq: time, observedAtMs: time,
          app: { pid: 100, bundleId: app },
          surface: { kind: kind === 'url' ? 'browser' : 'editor' },
          resource: { kind, canonicalUri: uri, displayLabel: uri.split('/').at(-1) ?? '' },
          workspace: { id: workspace, root: '/synthetic/' + workspace,
            title: workspace, source: 'dsh', confidence: 1 },
          activity: event ? { event } : {},
          privacy: { secure: false, protected: false },
          source: { provider: 'macos-ax', adapter: 'vscode' },
          policyRevision: 1, expiresAtMs: TEST_DATE + 86_400_000,
        }
        const resourceId = resources.upsert(observation.resource!, time)
        const observationId = observations.insert(observation, resourceId)
        episodes.replace({
          id: EpisodeId(id), startedAtMs: time, endedAtMs: time,
          startReason: 'first-observation', endReason: 'timeout',
          workspace: { id: workspace, root: '/synthetic/' + workspace, title: workspace },
          threadKey: 'workspace:' + workspace, lastStrongResourceId: resourceId,
          summaryKind: 'deterministic', summary: 'Synthetic QA history in ' + workspace,
          confidence: 1, state: 'closed', createdAtMs: time,
          updatedAtMs: time, expiresAtMs: TEST_DATE + 86_400_000,
          observationIds: [observationId],
        })
      }
      seed('qa-cad-episode', 'file',
        'file:///synthetic/QA-RobotArm/model_joint.step',
        'com.synthetic.solidworks', 'QA-RobotArm', OCT9, 'save')
      seed('qa-web-episode', 'url',
        'https://example.edu/SYNTHETIC_QA_ONLY/robotics-paper',
        'com.synthetic.browser', 'QA-Research', OCT9 + 1000)
      seed('qa-test-episode', 'file',
        'file:///synthetic/QA-RobotArm/test-log.txt',
        'com.synthetic.vscode', 'QA-RobotArm', OCT9 + 2000, 'verify-test-success')

      const queries: unknown[] = []
      ctx.provide('computerHistory', {
        async queryEvidence(query: import('../../src/shared/index.js').HistoryEvidenceQuery) {
          if (queries.length >= 4) throw new Error('synthetic query-call budget reached')
          queries.push(query)
          return {
            ...episodes.queryEvidence(query, TEST_DATE),
            notesAccess: 'not-searched' as const,
            caveat: 'SYNTHETIC_QA_ONLY: Episode pointers are historical; do not claim present-day file validity.',
          }
        },
      } as never)
      const model = new RealRestrictedModel()
      ctx.llm.registerAdapter(['synthetic-deepseek'], model)
      const handle = await ctx.agents.create({
        sessionId: SessionId('synthetic-sixth-live'),
        agentOptions: { provider: 'synthetic-deepseek', model: 'deepseek-chat' },
      })
      const unregister = registerHistoryEvidenceQueryTool(handle.agent.ctx)
      const guard = handle.agent.ctx.tools.guard(exec => exec.name === ALLOWED_TOOL
        ? undefined : 'SYNTHETIC QA prohibits non-History tools')
      const visible = ctx.tools.schemas(handle.agent).map(t => t.name)
      expect(visible).toEqual([ALLOWED_TOOL])
      handle.agent.followup(createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text:
          '今天是2026年10月10日。请从合成工作历史里找到昨天在机械臂项目保存过的 STEP 模型，给出准确的文件 URI 和来源 Episode ID，并说明历史保存不代表文件现在仍然存在。不得猜测。' }],
      }))
      await handle.agent.whenIdle()
      expect(queries.length).toBeGreaterThan(0)
      expect(model.requests.length).toBeGreaterThanOrEqual(2)
      const allTools = model.requests.flatMap(req => req.tools?.map(tool => tool.name) ?? [])
      expect(new Set(allTools)).toEqual(new Set([ALLOWED_TOOL]))
      const toolEvidence = model.requests.slice(1).map(req => JSON.stringify(req.messages)).join('\n')
      expect(toolEvidence).toContain('qa-cad-episode')
      const answer = model.outputs.join('\n')
      expect(answer).toContain('model_joint.step')
      expect(answer).toContain('qa-cad-episode')
      expect(answer).not.toContain('qa-web-episode')
      // A selected source Episode enters the SAME validated Continue function as UI.
      const continued: string[] = []
      await continueFromHistoryHit({
        id: 'qa-hit-1', episodeId: 'qa-cad-episode',
      } as never, async selectedId => episodes.getRetained(
        EpisodeId(selectedId), TEST_DATE,
      )!, async selected => { continued.push(String(selected.id)) })
      expect(continued).toEqual(['qa-cad-episode'])
      console.log('SYNTHETIC_LIVE_QA_SUMMARY', JSON.stringify({
        modelRequests: model.requests.length, historyQueries: queries.length,
        returnedCorrectEpisode: answer.includes('qa-cad-episode'),
        answeredWithExactUri: answer.includes('model_joint.step'),
        continueTarget: continued[0], toolAllowlistEnforced: true,
      }))
      guard()
      unregister()
      await handle.dispose()
    } finally {
      await ctx.fiber.dispose()
      closeDatabase?.()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
