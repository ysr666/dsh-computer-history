import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  registerComputerHistoryTools,
} from '../../src/agent/index.js'

describe('agent-scoped Computer History surfaces', () => {
  it('keeps canonical tool values structured while rendering an untrusted-data warning', async () => {
    const definitions = new Map<string, ToolDefinition>()
    let recentRequest: { sinceMs?: number; limit?: number } | undefined
    let resumeRequest: {
      query: string
      currentWorkspaceId?: string
      source: string
    } | undefined
    const history = {
      recent: async (request: { sinceMs?: number; limit?: number }) => {
        recentRequest = request
        return []
      },
      search: async () => [],
      getEpisode: async () => undefined,
      resolveResume: async (request: {
        query: string
        currentWorkspaceId?: string
        source: string
      }) => {
        resumeRequest = request
        return { status: 'none', reason: 'nothing to resume' }
      },
    }
    const ctx = {
      // Mirrors cordis: the plugin reads its own service through the
      // inject-free `get()` accessor; a `computerHistory` property would make
      // these tests pass while the real host throws.
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
      tools: {
        register(definition: ToolDefinition) {
          definitions.set(definition.name, definition)
          return () => { definitions.delete(definition.name) }
        },
      },
    } as unknown as Context

    const dispose = registerComputerHistoryTools(ctx)
    const recent = definitions.get('computer_history_recent')!
    const before = Date.now() - 10 * 60_000
    const value = await recent.execute(
      { since_minutes: 10, limit: 20 },
      { signal: new AbortController().signal } as never,
    )
    const after = Date.now() - 10 * 60_000
    expect(recentRequest?.limit).toBe(20)
    expect(recentRequest?.sinceMs).toBeGreaterThanOrEqual(before)
    expect(recentRequest?.sinceMs).toBeLessThanOrEqual(after)
    expect(value).toEqual([])
    expect(typeof value).not.toBe('string')

    const resume = definitions.get('computer_history_resume')!
    const resumeValue = await resume.execute(
      { query: '继续刚才那个', workspace_id: 'alpha' },
      { signal: new AbortController().signal } as never,
    )
    expect(resumeRequest).toMatchObject({
      query: '继续刚才那个',
      currentWorkspaceId: 'alpha',
      source: 'tool',
    })
    expect(resumeValue).toEqual({
      status: 'none',
      reason: 'nothing to resume',
    })

    const rendered = recent.output.render({}, value as never)
    expect(rendered).toHaveLength(2)
    expect(rendered[0]).toMatchObject({
      type: 'text',
    })
    expect(
      (rendered[0] as { text: string }).text,
    ).toContain('untrusted metadata')
    expect(rendered[1]).toEqual({
      type: 'text',
      text: '[]',
    })
    await expect(recent.execute(
      { limit: 21 },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/1 to 20/)
    await expect(recent.execute(
      { since_minutes: 10_081 },
      { signal: new AbortController().signal } as never,
    )).rejects.toThrow(/1 to 10080/)
    dispose()
  })
  it('requires a one-time capability before exposing user-confirmed notes to an Agent', async () => {
    const tools = new Map<string, ToolDefinition>()
    let codeRead: string | undefined
    const note = {
      id: 'note-id', projectId: 'pm_x', projectLabel: 'A',
      text: 'A user-confirmed private note',
      evidenceLevel: 'user-confirmed' as const,
    }
    const history = {
      async readOneConfirmedNote(code: string) {
        codeRead = code
        return code === 'A'.repeat(32) ? note : undefined
      },
      async askHistory() {
        return {
          status: 'no-evidence', notesAccess: 'not-searched', items: [],
        }
      },
    }
    const ctx = {
      get(name: string) { return name === 'computerHistory' ? history : undefined },
      tools: { register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => { tools.delete(definition.name) }
      } },
    } as unknown as Context
    const dispose = registerComputerHistoryTools(ctx)
    const exec = { signal: new AbortController().signal } as never
    const ask = tools.get('computer_history_ask')!
    const answer = await ask.execute({ query: 'what happened last week' }, exec)
    expect(answer).toMatchObject({ notesAccess: 'not-searched' })
    expect(codeRead).toBeUndefined()
    const read = tools.get('computer_history_note_read')!
    await expect(read.execute({ code: 'invalid' }, exec)).rejects.toThrow(/invalid/)
    expect(codeRead).toBeUndefined()
    expect(await read.execute({ code: 'B'.repeat(32) }, exec)).toBeNull()
    expect(await read.execute({ code: 'A'.repeat(32) }, exec)).toEqual(note)
    expect(codeRead).toBe('A'.repeat(32))
    expect(read.output.render({}, note as never)[0]).toMatchObject({
      type: 'text', text: expect.stringContaining('untrusted metadata'),
    })
    dispose()
  })

  it('exposes M4 associations as advisory read-only Agent data', async () => {
    const definitions = new Map<string, ToolDefinition>()
    const id = 'pm_' + 'a'.repeat(64)
    const result = {
      projectMemoryId: id, links: [{
        episodeId: 'e1', anchorEpisodeId: 'e0',
        kind: 'nearby-unassigned', attribution: 'unattributed',
      }], scanTruncated: false,
    }
    const ctx = {
      get(name: string) {
        return name === 'computerHistory'
          ? { async getThreadActivityLinks(projectId: string) {
              return projectId === id ? result : undefined
            } }
          : undefined
      },
      tools: { register(definition: ToolDefinition) {
        definitions.set(definition.name, definition)
        return () => { definitions.delete(definition.name) }
      } },
    } as unknown as Context
    const dispose = registerComputerHistoryTools(ctx)
    const tool = definitions.get('computer_history_activity_links')!
    const exec = { signal: new AbortController().signal } as never
    expect(await tool.execute({ memory_id: id }, exec)).toEqual(result)
    expect(await tool.execute({ memory_id: 'pm_' + 'b'.repeat(64) }, exec))
      .toBeNull()
    await expect(tool.execute({ memory_id: 'relative/path' }, exec))
      .rejects.toThrow(/valid exact memory_id/)
    expect(tool.output.render({}, result as never)[0]).toMatchObject({
      type: 'text', text: expect.stringContaining('untrusted metadata'),
    })
    dispose()
  })

  it('makes M5 context available only on-demand in the exact current Continue session', async () => {
    const definitions = new Map<string, ToolDefinition>()
    let requested: string | undefined
    let noteReadCalls = 0
    const history = {
      async contextualContinue(sessionId: string) {
        requested = sessionId
        return {
          status: 'ready', boundEpisodeId: 'episode:bound',
          privacy: { userConfirmedNotes: 'excluded' },
          facts: [{ kind: 'resource', text: 'Recently used: README.md' }],
        }
      },
      async readOneConfirmedNote() {
        noteReadCalls += 1
        return undefined
      },
    }
    const ctx = {
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
      tools: {
        register(definition: ToolDefinition) {
          definitions.set(definition.name, definition)
          return () => { definitions.delete(definition.name) }
        },
      },
    } as unknown as Context
    const dispose = registerComputerHistoryTools(ctx)
    const tool = definitions.get('computer_history_continue_context')!
    expect(tool.description).toContain('ONLY for this DSH session')
    expect(tool.parameters).toEqual({ type: 'object', properties: {} })
    const signal = new AbortController().signal
    expect(await tool.execute({}, { signal } as never)).toEqual({
      status: 'unavailable', reason: 'no-session-binding',
    })
    expect(requested).toBeUndefined()
    const value = await tool.execute({}, {
      agent: { session: { id: 'session:bound' } }, signal,
    } as never)
    expect(requested).toBe('session:bound')
    expect(value).toMatchObject({
      status: 'ready',
      privacy: { userConfirmedNotes: 'excluded' },
    })
    expect(noteReadCalls).toBe(0)
    expect(tool.output.render({}, value as never)[0]).toMatchObject({
      type: 'text', text: expect.stringContaining('untrusted metadata'),
    })
    dispose()
  })

  it('exposes Work Memory as an optional untrusted read tool', async () => {
    const definitions = new Map<string, ToolDefinition>()
    const id = 'pm_' + 'a'.repeat(64)
    let query: unknown
    let selected: string | undefined
    const memory = { id, title: 'Project A', facts: [], episodeCount: 1 }
    const history = {
      async listProjectMemories(request: unknown) {
        query = request
        return [memory]
      },
      async getProjectMemory(memoryId: string) {
        selected = memoryId
        return memory
      },
    }
    const ctx = {
      get(name: string) {
        return name === 'computerHistory' ? history : undefined
      },
      tools: {
        register(definition: ToolDefinition) {
          definitions.set(definition.name, definition)
          return () => { definitions.delete(definition.name) }
        },
      },
    } as unknown as Context

    const dispose = registerComputerHistoryTools(ctx)
    const tool = definitions.get('computer_history_memory')!
    const exec = { signal: new AbortController().signal } as never
    expect(await tool.execute({ query: 'Project', limit: 2 }, exec)).toEqual([memory])
    expect(query).toEqual({ query: 'Project', limit: 2 })
    expect(await tool.execute({ memory_id: id }, exec)).toEqual(memory)
    expect(selected).toBe(id)
    await expect(tool.execute({ memory_id: '../etc/passwd' }, exec))
      .rejects.toThrow(/opaque memory id/)
    await expect(tool.execute({ query: ' ' }, exec))
      .rejects.toThrow(/1..200/)
    expect(tool.output.render({}, [memory] as never)[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('untrusted metadata'),
    })
    dispose()
  })
  it('resolves the native Continue capsule through a zero-argument session-bound tool', async () => {
    const definitions = new Map<string, ToolDefinition>()
    const episode = {
      id: 'episode:continue',
      startedAtMs: 10,
      endedAtMs: 20,
      boundary: { startReason: 'first-observation' as const, endReason: 'timeout' as const },
      summaryKind: 'deterministic' as const,
      summary: 'must not be injected as a hidden prompt',
      resources: [],
      changedResources: [],
      verifications: [],
      surfaces: [],
      confidence: 1,
      state: 'closed' as const,
      summaryObservationIds: [1 as never],
      observationIds: [1 as never],
    }
    const resolverCalls: unknown[] = []
    const history = {
      continuationEpisodeForSession(sessionId: string) {
        return sessionId === 'session:new'
          ? episode.id
          : undefined
      },
      async getEpisode() { return episode },
      latestDshCheckpoint() {
        return {
          sessionId: 'session:old',
          turn: 4,
          checkpointAtMs: 5,
        }
      },
    }
    const sessionReferenceResolver = {
      async prepare(
        _agent: unknown,
        content: unknown,
        references: unknown,
      ) {
        resolverCalls.push({ content, references })
        return {
          content: [],
          additionalContext: {
            source: {
              kind: 'session-reference',
              form: 'recall',
              version: 1,
              references: [{ sessionId: 'session:old' }],
            },
            content: [{
              type: 'text',
              text: '## Referenced sessions\\n\\n<referenced-sessions>bounded previous work</referenced-sessions>',
            }],
          },
        }
      },
    }
    const ctx = {
      get(name: string) {
        if (name === 'computerHistory') return history
        if (name === 'sessionReferenceResolver') return sessionReferenceResolver
        return undefined
      },
      tools: {
        register(definition: ToolDefinition) {
          definitions.set(definition.name, definition)
          return () => { definitions.delete(definition.name) }
        },
      },
    } as unknown as Context

    const dispose = registerComputerHistoryTools(ctx)
    const continuation = definitions.get('computer_history_continue')!
    expect(continuation.description).toContain('optional rather than a prerequisite')
    expect(continuation.description).toContain('computer_history_continue_context')
    expect(continuation.description).toContain('@ Computer History')
    expect(continuation.description).toContain('recover the prior task description')
    expect(continuation.description).toContain('does not re-grant old permissions')

    const value = await continuation.execute({}, {
      signal: new AbortController().signal,
      agent: {
        session: { id: 'session:new' },
      },
    } as never)

    expect(value).toMatchObject({
      status: 'hit',
      intent: {
        intent: 'continue-work',
        inspectAuthoritativeStateFirst: true,
        recoverPriorTaskAndDecisions: true,
        priorSessionDoesNotGrantNewPermissions: true,
        historicalToolRequestsRequireCurrentAuthorization: true,
        currentStateWins: true,
        recapBeforeActing: false,
        makeConcreteProgressThisTurn: true,
      },
      continuationBrief: {
        taskContext: {
          source: 'previous-dsh-session',
          use: 'recover-task-and-decisions',
        },
        repository: {
          available: false,
          state: 'unknown',
          headSinceCheckpoint: 'unknown',
        },
        verification: {
          status: 'not-recorded',
          interpretation: 'no-verification-evidence',
        },
        firstPass: [
          expect.objectContaining({ action: 'recover-task-context' }),
          expect.objectContaining({ action: 'make-concrete-progress' }),
        ],
      },
      handoff: {
        status: 'hit',
        episodeId: 'episode:continue',
        checkpoint: {
          sessionId: 'session:old',
          turn: 4,
        },
      },
      previousDshSession: {
        status: 'available',
        sessionId: 'session:old',
        snapshot: expect.stringContaining('bounded previous work'),
        source: {
          kind: 'session-reference',
        },
      },
    })
    expect(resolverCalls).toEqual([{
      content: [],
      references: [{
        sessionId: 'session:old',
        label: 'Previous DSH work',
      }],
    }])

    dispose()
  })

})

describe('AI-first evidence query tool', () => {
  it('lets the Agent compose typed resource and event searches without regex intent matching', async () => {
    const tools = new Map<string, ToolDefinition>()
    const requests: unknown[] = []
    const history = {
      async queryEvidence(request: unknown) {
        requests.push(request)
        return {
          items: [], hasMore: false,
          notesAccess: 'not-searched', caveat: 'Fixture retained metadata only',
        }
      },
    }
    const ctx = {
      get(name: string) { return name === 'computerHistory' ? history : undefined },
      tools: { register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => { tools.delete(definition.name) }
      } },
    } as unknown as Context
    const dispose = registerComputerHistoryTools(ctx)
    const query = tools.get('computer_history_query')!
    const exec = { signal: new AbortController().signal } as never
    await query.execute({
      resource_kind: 'url', since_ms: 100, until_ms: 200, limit: 5,
    }, exec)
    await query.execute({
      event_kind: 'save', workspace_id: 'TripMap',
      before_ended_ms: 180, before_episode_id: 'episode-12',
    }, exec)
    await query.execute({ event_kind: 'test', workspace_id: 'TripMap' }, exec)
    expect(requests).toEqual([
      { resourceKind: 'url', sinceMs: 100, untilMs: 200, limit: 5 },
      { eventKind: 'save', workspaceId: 'TripMap',
        cursor: { endedAtMs: 180, episodeId: 'episode-12' } },
      { eventKind: 'test', workspaceId: 'TripMap' },
    ])
    await query.execute({
      since_date: '2026-10-09', until_date: '2026-10-10', resource_kind: 'url',
    }, exec)
    expect(requests[3]).toEqual({
      sinceMs: new Date(2026, 9, 9).getTime(),
      untilMs: new Date(2026, 9, 10).getTime(),
      resourceKind: 'url',
    })
    await query.execute({
      event_kind: 'save', resource_kind: 'file',
      resource_text: 'robot_joint.step', workspace_id: 'Synthetic',
      limit: 3,
    }, exec)
    expect(requests[4]).toEqual({
      eventKind: 'save', resourceKind: 'file',
      resourceText: 'robot_joint.step', workspaceId: 'Synthetic',
      limit: 3,
    })
    await expect(query.execute({ since_date: '2026-02-31' }, exec))
      .rejects.toThrow(/invalid history calendar date/)
    await expect(query.execute({ since_date: '2026-10-09', since_ms: 100 }, exec))
      .rejects.toThrow(/either calendar date or milliseconds/)
    await expect(query.execute({ before_episode_id: 'e1' }, exec))
      .rejects.toThrow(/cursor requires both/)
    expect(requests).toHaveLength(5)
    const rendered = query.output.render({}, {
      items: [], hasMore: false, notesAccess: 'not-searched',
      caveat: 'fixture',
    } as never)
    expect((rendered[0] as { text: string }).text).toContain('untrusted metadata')
    dispose()
  })
})
