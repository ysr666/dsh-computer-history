/**
 * Deterministic complete Find → evidence-backed Answer → exact Continue.
 * The Agent Loop, actual History tool, SQLite query and Continue Host binding
 * are real; ONLY the LLM behavior and historical activity are synthetic.
 * No provider keys, production History store, or generic DSH tools involved.
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
import {
  CollectorSessionId, EpisodeId, type ActivityObservation, type HistoryEvidenceQuery,
  type EpisodeSummary,
} from '../../src/shared/index.js'
import { registerHistoryEvidenceQueryTool } from '../../src/agent/tools.js'
import { continueFromHistoryHit } from '../../src/client/ask-history-view.js'
import { DeletionService } from '../../src/host/retention/index.js'
import { LocalComputerHistoryBackend, type CaptureController } from '../../src/host/service/index.js'
import { SemanticOptInStore } from '../../src/host/semantic/opt-in.js'
import {
  EpisodeStore, ObservationStore, ResourceStore, PolicyStore, openHistoryDatabase,
} from '../../src/host/store/index.js'

const NOW = new Date(2026, 9, 10, 14).getTime()
const YESTERDAY = new Date(2026, 9, 9, 14).getTime()
const ONLY_TOOL = 'computer_history_query'
const SOURCE_URI = 'file:///synthetic/QA-RobotArm/model_joint.step'
const SOURCE_EPISODE = 'qa-cad-episode'

class NoCapture implements CaptureController {
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async recover(): Promise<void> {}
  getState() {
    return { enabled: false, capture: 'stopped' as const, accessibilityTrusted: false }
  }
}

type FacetCall = { readonly [key: string]: string | number }

class EvidenceFixtureModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly answers: string[] = []
  constructor(private readonly calls: readonly FacetCall[]) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const turn = this.requests.push(options)
    if (turn > 5) throw new Error('Synthetic QA model turn limit exceeded')
    if (options.tools?.map(tool => tool.name).join() !== ONLY_TOOL) {
      throw new Error('Unexpected model-visible tools')
    }
    if (turn <= this.calls.length) {
      const id = ToolCallId('synthetic-call-' + turn)
      const args = JSON.stringify(this.calls[turn - 1])
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: ONLY_TOOL, argumentsDelta: args }
      yield { type: 'block-end', index: 0,
        block: { type: 'tool-call', id, name: ONLY_TOOL, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    // Unlike canned success text, this answer is assembled ONLY from the actual
    // DSH tool-result JSON after the real SQLite query has completed.
    const records: EpisodeSummary[] = []
    for (const toolMessage of options.messages.filter(entry => entry.role === 'tool')) {
      for (const block of toolMessage.content) {
        if (block.type !== 'text' || !block.text.startsWith('{"items":')) continue
        const parsed = JSON.parse(block.text) as { items: EpisodeSummary[] }
        records.push(...parsed.items)
      }
    }
    const cad = records.find(item => item.resources.some(resource =>
      resource.kind === 'file' && resource.canonicalUri === SOURCE_URI))
    const answer = cad
      ? 'Recorded CAD work: ' + SOURCE_URI + ' (Episode ' + String(cad.id)
        + '). This is historical evidence, not proof the file currently exists.'
      : 'No matching saved CAD Episode was found; absence of evidence is not proof it never happened.'
    this.answers.push(answer)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: answer }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function runScenario(facets: readonly FacetCall[], expireBeforeContinue = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dch-find-continue-synthetic-'))
  const ctx = new Context()
  const connection = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'), nowMs: NOW,
  })
  let handle: Awaited<ReturnType<typeof ctx.agents.create>> | undefined
  let unregister: (() => void) | undefined
  let unguard: (() => void) | undefined
  try {
    await ctx.plugin(Sessions)
    await ctx.plugin(Agents)
    await ctx.plugin(Llm)
    await ctx.plugin(Tools)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Projections)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })

    const episodes = new EpisodeStore(connection.db)
    const observations = new ObservationStore(connection.db)
    const resources = new ResourceStore(connection.db)
    const policies = new PolicyStore(connection.db)
    policies.ensureInitial(1)

    function seed(
      id: string, kind: 'file' | 'url', uri: string, app: string,
      workspace: string, time: number, event?: 'save' | 'verify-test-success',
    ) {
      const input: ActivityObservation = {
        collectorSessionId: CollectorSessionId('synthetic-find-continue'),
        seq: time, observedAtMs: time,
        app: { pid: 71, bundleId: app },
        surface: { kind: kind === 'url' ? 'browser' : 'editor' },
        resource: { kind, canonicalUri: uri, displayLabel: uri.split('/').at(-1) ?? '' },
        workspace: { id: workspace, root: '/synthetic/' + workspace,
          title: workspace, source: 'dsh', confidence: 1 },
        activity: event ? { event } : {},
        privacy: { secure: false, protected: false },
        source: { provider: 'macos-ax', adapter: 'vscode' },
        policyRevision: 1, expiresAtMs: NOW + 86_400_000,
      }
      const resId = resources.upsert(input.resource!, time)
      const obsId = observations.insert(input, resId)
      episodes.replace({
        id: EpisodeId(id), startedAtMs: time, endedAtMs: time,
        startReason: 'first-observation', endReason: 'timeout',
        workspace: { id: workspace, root: '/synthetic/' + workspace, title: workspace },
        threadKey: 'workspace:' + workspace, lastStrongResourceId: resId,
        summaryKind: 'deterministic', summary: 'Synthetic work in ' + workspace,
        confidence: 1, state: 'closed', createdAtMs: time, updatedAtMs: time,
        expiresAtMs: NOW + 86_400_000, observationIds: [obsId],
      })
    }

    seed(SOURCE_EPISODE, 'file', SOURCE_URI,
      'com.synthetic.solidworks', 'QA-RobotArm', YESTERDAY, 'save')
    // Another workspace may have a file with the SAME basename.
    seed('qa-other-cad-episode', 'file',
      'file:///synthetic/QA-Other/model_joint.step',
      'com.synthetic.cad', 'QA-Other', YESTERDAY + 500, 'save')
    seed('qa-web-episode', 'url', 'https://example.edu/synthetic-robotics-paper',
      'com.synthetic.browser', 'QA-Research', YESTERDAY + 1000)
    seed('qa-test-episode', 'file', 'file:///synthetic/QA-RobotArm/test-log.txt',
      'com.synthetic.editor', 'QA-RobotArm', YESTERDAY + 2000, 'verify-test-success')

    const backend = new LocalComputerHistoryBackend(
      episodes, policies, new DeletionService(connection.db), new NoCapture(), {
        observationRetentionHours: 24, episodeRetentionDays: 30,
        autoResume: false, now: () => NOW,
      }, undefined, new SemanticOptInStore(connection.db), connection.db,
    )
    const actualQueries: HistoryEvidenceQuery[] = []
    const returnedIds: string[][] = []
    ctx.provide('computerHistory', {
      async queryEvidence(query: HistoryEvidenceQuery) {
        if (actualQueries.length >= 4) throw new Error('Synthetic evidence budget exhausted')
        actualQueries.push(query)
        const result = await backend.queryEvidence(query)
        returnedIds.push(result.items.map(item => String(item.id)))
        return result
      },
    } as never)

    const model = new EvidenceFixtureModel(facets)
    ctx.llm.registerAdapter(['synthetic-find-continue'], model)
    handle = await ctx.agents.create({
      sessionId: SessionId('synthetic-find-continue-session'),
      agentOptions: { provider: 'synthetic-find-continue', model: 'fixture' },
    })
    unregister = registerHistoryEvidenceQueryTool(handle.agent.ctx)
    const exposed = ctx.tools.schemas(handle.agent).map(tool => tool.name)
    if (exposed.join() !== ONLY_TOOL) throw new Error('Unsafe QA tool registration')
    unguard = handle.agent.ctx.tools.guard(exec =>
      exec.name === ONLY_TOOL ? undefined : 'Other tools forbidden by synthetic QA')
    handle.agent.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text',
        text: 'Locate my synthetic CAD file from yesterday, quote its source Episode, then prepare Continue.' }],
    }))
    await handle.agent.whenIdle()
    const answer = model.answers.at(-1) ?? ''
    let continued: string | undefined
    if (answer.includes(SOURCE_EPISODE)) {
      if (expireBeforeContinue) {
        connection.db.prepare('UPDATE episodes SET expires_at_ms = ? WHERE id = ?')
          .run(NOW - 1, SOURCE_EPISODE)
      }
      await continueFromHistoryHit({
        id: 'qa-selected-search-hit', episodeId: SOURCE_EPISODE,
      } as never,
      async id => episodes.getRetained(EpisodeId(id), NOW)!,
      async episode => {
        backend.bindContinuationSession({
          sessionId: 'synthetic-resume-session', episodeId: episode.id,
        })
        continued = String(backend.continuationEpisodeForSession('synthetic-resume-session'))
      })
    }
    return {
      answer, continued, queries: actualQueries, returnedIds,
      modelCalls: model.requests.length,
      toolCount: model.requests.flatMap(request => request.tools?.map(tool => tool.name) ?? []),
    }
  } finally {
    unguard?.()
    unregister?.()
    if (handle) await handle.dispose()
    await ctx.fiber.dispose()
    connection.close()
    rmSync(root, { recursive: true, force: true })
  }
}

describe('Find → evidence-grounded Answer → exact Host Continue, synthetic only', () => {
  it('locates the CAD save through real SQLite and binds the exact Episode', async () => {
    const result = await runScenario([{
      resource_kind: 'file', event_kind: 'save', resource_text: 'model_joint.step',
      since_date: '2026-10-09', until_date: '2026-10-10',
    }])
    expect(result.queries).toHaveLength(1)
    expect(result.answer).toContain(SOURCE_URI)
    expect(result.answer).toContain(SOURCE_EPISODE)
    expect(result.answer).not.toContain('qa-web-episode')
    expect(result.answer).toContain('not proof')
    expect(result.continued).toBe(SOURCE_EPISODE)
    expect(result.modelCalls).toBe(2)
    expect(result.toolCount).toEqual([ONLY_TOOL, ONLY_TOOL])
  })

  it('scopes duplicate CAD filenames to the selected workspace', async () => {
    const result = await runScenario([{
      workspace_id: 'QA-RobotArm', event_kind: 'save', resource_kind: 'file',
      text: 'model_joint.step',
      since_date: '2026-10-09', until_date: '2026-10-10',
    }])
    expect(result.returnedIds).toEqual([[SOURCE_EPISODE]])
    expect(result.answer).not.toContain('qa-other-cad-episode')
    expect(result.continued).toBe(SOURCE_EPISODE)
  })

  it('rejects a non-existent workspace rather than selecting the nearest project', async () => {
    const result = await runScenario([{
      workspace_id: 'QA-Does-Not-Exist', event_kind: 'save',
      resource_kind: 'file',
    }])
    expect(result.returnedIds).toEqual([[]])
    expect(result.answer).toContain('No matching')
    expect(result.continued).toBeUndefined()
  })

  it('combines save + verification queries without selecting a wrong Episode', async () => {
    const result = await runScenario([
      { event_kind: 'save', resource_kind: 'file',
        since_date: '2026-10-09', until_date: '2026-10-10' },
      { event_kind: 'test',
        since_date: '2026-10-09', until_date: '2026-10-10' },
    ])
    expect(result.queries.map(query => query.eventKind)).toEqual(['save', 'test'])
    expect(result.answer).toContain(SOURCE_EPISODE)
    expect(result.continued).toBe(SOURCE_EPISODE)
    expect(result.modelCalls).toBe(3)
  })

  it('does not invent a matching Episode when the database returns none', async () => {
    const result = await runScenario([{
      event_kind: 'build', resource_kind: 'file',
      since_date: '2026-10-09', until_date: '2026-10-10',
    }])
    expect(result.answer).toContain('No matching')
    expect(result.answer).not.toContain(SOURCE_EPISODE)
    expect(result.continued).toBeUndefined()
  })

  it('refuses Continue when the selected Episode expires after the answer', async () => {
    await expect(runScenario([{
      event_kind: 'save', resource_kind: 'file',
      since_date: '2026-10-09', until_date: '2026-10-10',
    }], true)).rejects.toThrow(/unavailable/)
  })
})
