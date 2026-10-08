import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  COMPUTER_HISTORY_REFERENCE_LABEL,
  computerHistoryReferenceUri,
  formatComputerHistoryMention,
  hasComputerHistoryMention,
  stripComputerHistoryMention,
} from '../../src/shared/index.js'
import {
  COMPUTER_HISTORY_REFERENCE_SOURCE,
  computerHistoryReference,
  continueEpisodeInDsh,
} from '../../src/client/continuation-reference.js'
import type { EpisodeSummary } from '../../src/shared/index.js'

afterEach(() => { vi.unstubAllGlobals() })

function episode(workspace: EpisodeSummary['workspace'] = {
  id: 'workspace:test',
  root: '/repo/work',
  title: 'work',
}): EpisodeSummary {
  return {
    id: 'episode:with/slashes and spaces' as EpisodeSummary['id'],
    startedAtMs: 1,
    endedAtMs: 2,
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    summaryKind: 'deterministic',
    summary: 'must never enter the composer chip',
    workspace,
    surfaces: [],
    resources: [],
    confidence: 1,
    state: 'closed',
    summaryObservationIds: [1 as never],
  }
}

function fixture(options: {
  workspaceItems?: readonly any[]
  createWorkspace?: (input: { path: string }) => Promise<any>
  initializeDefault?: () => Promise<any>
  selectedSessionId?: string
  openThrowsAfterInsert?: boolean
  draft?: string
} = {}) {
  const selectedSessionId = options.selectedSessionId ?? 'session:new'
  const scope = {} as Context
  const insertReference = vi.fn().mockReturnValue(true)
  const setDraft = vi.fn()
  const focus = vi.fn()
  const input = {
    state: {
      getSnapshot: () => ({
        draft: options.draft ?? '',
        occurrences: [],
        attachmentIds: [],
        draftRev: 7,
        phase: 'plain',
        queue: [],
      }),
    },
    insertReference,
    setDraft,
    focus,
  }
  const release = vi.fn()
  const sessions = {
    retain: vi.fn().mockReturnValue({
      sessionId: 'session:new',
      ready: Promise.resolve({}),
      release,
    }),
    scope: vi.fn().mockReturnValue(scope),
  }
  const createWorkspace = vi.fn(options.createWorkspace ?? (async ({ path }) => ({
    workspaceId: 'workspace:created',
    path,
    title: 'created',
    sessionIds: [],
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  })))
  const initializeDefault = vi.fn(options.initializeDefault ?? (async () => ({
    workspaceId: 'workspace:default',
    path: '/default',
    title: 'Default',
    sessionIds: [],
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  })))
  const workspaces = {
    list: {
      getSnapshot: () => ({
        phase: 'ready',
        state: 'idle',
        error: null,
        archivedSessionIds: [],
        pinnedSessionIds: [],
        items: options.workspaceItems ?? [{
          workspaceId: 'workspace:test',
          path: '/repo/work',
          title: 'work',
          sessionIds: [],
          createdAt: '2026-10-06T00:00:00.000Z',
          updatedAt: '2026-10-06T00:00:00.000Z',
        }],
      }),
    },
    create: createWorkspace,
    initializeDefault,
  }
  const connectWorkspace = vi.fn().mockResolvedValue('session:new')
  const openWorkspace = vi.fn(async (_workspaceId, beforeOpen) => {
    beforeOpen?.(selectedSessionId)
    if (options.openThrowsAfterInsert) throw new Error('navigation failed')
  })
  const uiWorkspace = { connectWorkspace, openWorkspace }
  const conversation = { input: { for: vi.fn().mockReturnValue(input) } }
  const services = new Map<string, unknown>([
    ['sessions', sessions],
    ['workspaces', workspaces],
    ['uiWorkspace', uiWorkspace],
    ['conversation', conversation],
  ])
  const ctx = { get: (name: string) => services.get(name) } as unknown as Context
  return {
    ctx,
    sessions,
    workspaces,
    createWorkspace,
    initializeDefault,
    connectWorkspace,
    openWorkspace,
    input,
    insertReference,
    setDraft,
    focus,
    release,
  }
}

describe('Computer History continuation references', () => {
  it('keeps the composer chip opaque and identifier-free in visible text', () => {
    const item = episode()
    const insert = computerHistoryReference(item.id)

    expect(insert.source).toBe(COMPUTER_HISTORY_REFERENCE_SOURCE)
    expect(insert.label).toBe(COMPUTER_HISTORY_REFERENCE_LABEL)
    expect(insert.appearance).toBeUndefined()
    expect(insert.ref).toBe(computerHistoryReferenceUri(item.id))
    expect(insert.clipboardText).toBe(formatComputerHistoryMention(insert.ref))
    expect(insert.clipboardText).toBe('@"Computer History"')

    const visibleAndPersisted = JSON.stringify(insert)
    expect(visibleAndPersisted).not.toContain(item.summary)
    expect(visibleAndPersisted).not.toContain('Git state')
    expect(hasComputerHistoryMention(
      'please @"Computer History" continue',
    )).toBe(true)
    expect(stripComputerHistoryMention(
      'please @"Computer History" continue',
    )).toBe('please continue')
  })

  it('opens the exact existing Workspace and inserts the native chip in beforeOpen', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ bound: true }))
    vi.stubGlobal('fetch', fetchMock)
    const f = fixture()

    await continueEpisodeInDsh(f.ctx, episode())
    await Promise.resolve()

    expect(f.createWorkspace).not.toHaveBeenCalled()
    expect(f.initializeDefault).not.toHaveBeenCalled()
    expect(f.connectWorkspace).toHaveBeenCalledWith('workspace:test')
    expect(f.openWorkspace).toHaveBeenCalledWith(
      'workspace:test',
      expect.any(Function),
    )
    expect(f.insertReference).toHaveBeenCalledWith(
      expect.objectContaining({
        source: COMPUTER_HISTORY_REFERENCE_SOURCE,
        label: COMPUTER_HISTORY_REFERENCE_LABEL,
      }),
      { start: 0, end: 0, draftRev: 7 },
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'api/computer-history/resume/continue-session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session:new',
          episodeId: episode().id,
        }),
      }),
    )
    expect(f.focus).toHaveBeenCalled()
    expect(f.release).toHaveBeenCalledTimes(1)
  })

  it('idempotently registers an unlisted recorded local root as a DSH Workspace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ bound: true })))
    const f = fixture({ workspaceItems: [] })
    const item = episode({ root: '/new/project', title: 'project' })

    await continueEpisodeInDsh(f.ctx, item)

    expect(f.createWorkspace).toHaveBeenCalledWith({ path: '/new/project' })
    expect(f.connectWorkspace).toHaveBeenCalledWith('workspace:created')
    expect(f.openWorkspace).toHaveBeenCalledWith(
      'workspace:created',
      expect.any(Function),
    )
    expect(f.insertReference).toHaveBeenCalledTimes(1)
  })

  it('uses the official default Workspace for URL-only history instead of a random recent project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ bound: true })))
    const f = fixture({
      workspaceItems: [{
        workspaceId: 'workspace:unrelated',
        path: '/recent/unrelated',
        title: 'unrelated',
        sessionIds: [],
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z',
      }],
    })

    const { workspace: _workspace, ...urlEpisode } = episode()
    await continueEpisodeInDsh(f.ctx, urlEpisode)

    expect(f.createWorkspace).not.toHaveBeenCalled()
    expect(f.initializeDefault).toHaveBeenCalledTimes(1)
    expect(f.connectWorkspace).toHaveBeenCalledWith('workspace:default')
  })

  it('falls back to the official default Workspace when the historical root no longer registers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ bound: true })))
    const f = fixture({
      workspaceItems: [],
      createWorkspace: async () => { throw new Error('missing directory') },
    })

    await continueEpisodeInDsh(
      f.ctx,
      episode({ root: '/missing/old-project', title: 'old-project' }),
    )

    expect(f.createWorkspace).toHaveBeenCalledWith({
      path: '/missing/old-project',
    })
    expect(f.initializeDefault).toHaveBeenCalledTimes(1)
    expect(f.connectWorkspace).toHaveBeenCalledWith('workspace:default')
  })

  it('unbinds and clears the inserted chip if navigation fails after beforeOpen', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ bound: true }))
      .mockResolvedValueOnce(Response.json({ unbound: true }))
    vi.stubGlobal('fetch', fetchMock)
    const f = fixture({ openThrowsAfterInsert: true })

    await expect(continueEpisodeInDsh(f.ctx, episode()))
      .rejects.toThrow('navigation failed')

    expect(f.insertReference).toHaveBeenCalledTimes(1)
    expect(f.setDraft).toHaveBeenCalledWith('')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0])
      .toBe('api/computer-history/resume/continue-session/unbind')
    expect(f.release).toHaveBeenCalledTimes(1)
  })

  it('rejects a different blank Session selected during open and removes the binding', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ bound: true }))
      .mockResolvedValueOnce(Response.json({ unbound: true }))
    vi.stubGlobal('fetch', fetchMock)
    const f = fixture({ selectedSessionId: 'session:other' })

    await expect(continueEpisodeInDsh(f.ctx, episode()))
      .rejects.toThrow('different blank session')

    expect(f.insertReference).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses to overwrite a non-empty prepared draft before binding or navigation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ bound: true }))
    vi.stubGlobal('fetch', fetchMock)
    const f = fixture({ draft: 'keep me' })

    await expect(continueEpisodeInDsh(f.ctx, episode()))
      .rejects.toThrow('unexpectedly contains a draft')

    expect(f.insertReference).not.toHaveBeenCalled()
    expect(f.openWorkspace).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(f.release).toHaveBeenCalledTimes(1)
  })
})
