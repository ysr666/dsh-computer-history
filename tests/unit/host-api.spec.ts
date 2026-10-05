import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  HISTORY_API_PREFIX,
  registerHistoryApi,
} from '../../src/host/api/index.js'

interface RegisteredRoute {
  readonly path: string
  readonly methods: readonly string[]
  fetch(request: Request): Promise<Response>
}

interface Calls {
  recent?: unknown
  search?: unknown
  episode?: unknown
  thread?: unknown
  policy?: unknown
  deletion?: unknown
}

function harness(overrides: Record<string, unknown> = {}) {
  const routes = new Map<string, RegisteredRoute>()
  const calls: Calls = {}
  const state = {
    enabled: true,
    capture: 'running' as const,
    accessibilityTrusted: true,
    observationRetentionHours: 24,
    episodeRetentionDays: 30,
    autoResume: false,
  }
  const policy = {
    revision: 1,
    mode: 'include-only' as const,
    rules: [],
    updatedAtMs: 1,
  }

  const computerHistory = {
    getState: () => state,
    async recent(input: unknown) {
      calls.recent = input
      return []
    },
    async search(input: unknown) {
      calls.search = input
      return []
    },
    async getEpisode(id: unknown) {
      calls.episode = id
      return undefined
    },
    async threads() {
      return []
    },
    async thread(input: unknown) {
      calls.thread = input
      return undefined
    },
    async pause() {},
    async resume() {},
    async recover() {},
    getPolicy: () => policy,
    async replacePolicy(update: unknown) {
      calls.policy = update
      return policy
    },
    async delete(input: unknown) {
      calls.deletion = input
      return {
        observationsDeleted: 0,
        episodesDeleted: 0,
        episodesRebuilt: 0,
      }
    },
    ...overrides,
  }

  const ctx = {
    // Services are read through the inject-free accessor, exactly like the
    // real plugin: `ctx.computerHistory` throws in cordis ("cannot get
    // property ... without inject") because the plugin provides the service
    // itself and cannot declare it in `inject`.
    get(name: string) {
      return name === 'computerHistory' ? computerHistory : undefined
    },
    subprocess: {
      resolveExecutable: async (command: string) => command,
      spawn: () => ({ done: Promise.resolve({ exitCode: 0, signal: null }) }),
    },
    connection: {
      fetch: {
        register(route: RegisteredRoute) {
          // Faithful to the real registry: it keys Fetch routes by **exact
          // path**, so a second register() for the same path throws during
          // setup and takes the whole plugin fiber down with it. A fake that
          // silently overwrites cannot fail, and a guard that cannot fail is
          // not a guard - the duplicate /retention registration in 2.3 got past
          // this test for exactly that reason.
          if (routes.has(route.path)) {
            throw new Error(
              `connection: exact Fetch route "${route.path}" is already registered`,
            )
          }
          routes.set(route.path, route)
          return () => { routes.delete(route.path) }
        },
      },
    },
    effect(factory: () => unknown) {
      factory()
    },
  } as unknown as Context

  registerHistoryApi(ctx)

  async function request(
    suffix: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const path = HISTORY_API_PREFIX + suffix.split('?')[0]
    const route = routes.get(path)
    if (!route) throw new Error('route not registered: ' + path)
    return route.fetch(new Request(
      'https://example.test' + HISTORY_API_PREFIX + suffix,
      init,
    ))
  }

  return { calls, request, routes }
}

describe('Computer History Host API', () => {
  it('registers the stable route set and preserves no-store responses', async () => {
    const { request, routes } = harness()
    expect([...routes.keys()].toSorted()).toEqual([
      '/api/computer-history/audit/preview',
      '/api/computer-history/companion/editor',
      '/api/computer-history/companion/setup',
      '/api/computer-history/delete',
      '/api/computer-history/diagnostics',
      '/api/computer-history/episode',
      '/api/computer-history/export',
      '/api/computer-history/import',
      '/api/computer-history/pairing',
      '/api/computer-history/pairing/rotate',
      '/api/computer-history/pause',
      '/api/computer-history/policy',
      '/api/computer-history/recent',
      '/api/computer-history/recover',
      '/api/computer-history/resume',
      '/api/computer-history/resume-hint',
      '/api/computer-history/resume/open',
      '/api/computer-history/retention',
      '/api/computer-history/search',
      '/api/computer-history/semantic',
      '/api/computer-history/semantic/opt-in',
      '/api/computer-history/semantic/preview',
      '/api/computer-history/semantic/revoke',
      '/api/computer-history/state',
      '/api/computer-history/system/accessibility',
      '/api/computer-history/system/applications',
      '/api/computer-history/thread',
      '/api/computer-history/threads',
      '/api/computer-history/timeline',
    ])

    const response = await request('/state')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const setupResponse = await request('/companion/setup')
    expect(setupResponse.status).toBe(200)
    expect(setupResponse.headers.get('cache-control')).toBe('no-store')
    const setup = await setupResponse.json() as { chromium?: { available?: boolean } }
    expect(typeof setup.chromium?.available).toBe('boolean')

    const accessibility = await request('/system/accessibility')
    expect(accessibility.status).toBe(200)
    const capability = await accessibility.json() as { available?: unknown }
    expect(typeof capability.available).toBe('boolean')
    const opened = await request('/system/accessibility', { method: 'POST' })
    expect(opened.status).toBe(200)
    const result = await opened.json() as { status?: unknown }
    expect(['opened', 'unsupported']).toContain(result.status)
  })

  it('serves Desktop-safe export and diagnostics downloads', async () => {
    const { request } = harness({
      exportAll: () => ({ schema: 'dsh-computer-history/v1', tables: {} }),
      getState: () => ({
        enabled: true,
        capture: 'running',
        accessibilityTrusted: true,
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        release: {
          version: '0.1.0-dev.0',
          loadedFrom: '/Users/private/plugin',
        },
        companion: {
          listening: true,
          port: 19388,
          paired: true,
          editorPaired: true,
        },
      }),
    })

    const exportHead = await request('/export', { method: 'HEAD' })
    expect(exportHead.status).toBe(200)
    expect(exportHead.headers.get('content-disposition')).toContain('attachment;')
    expect(exportHead.headers.get('content-type')).toContain('application/json')

    const exportGet = await request('/export')
    expect(exportGet.status).toBe(200)
    expect(exportGet.headers.get('content-disposition')).toContain('computer-history-')
    await expect(exportGet.json()).resolves.toMatchObject({
      schema: 'dsh-computer-history/v1',
    })

    const diagnosticsHead = await request('/diagnostics', { method: 'HEAD' })
    expect(diagnosticsHead.status).toBe(200)
    expect(diagnosticsHead.headers.get('content-disposition'))
      .toContain('computer-history-diagnostics-')

    const diagnosticsGet = await request('/diagnostics')
    const diagnosticsText = await diagnosticsGet.text()
    expect(diagnosticsText).toContain('dsh-computer-history-diagnostics-v1')
    expect(diagnosticsText).not.toContain('/Users/private/plugin')
    expect(diagnosticsText).not.toContain('19388')
    expect(diagnosticsText).not.toContain('token')
  })
  it('uses the Host local calendar date for download filenames', async () => {
    const previousTz = process.env.TZ
    process.env.TZ = 'Asia/Shanghai'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T19:30:00.000Z'))
    try {
      const { request } = harness()
      const exportHead = await request('/export', { method: 'HEAD' })
      const diagnosticsHead = await request('/diagnostics', { method: 'HEAD' })
      expect(exportHead.headers.get('content-disposition'))
        .toContain('computer-history-2026-10-05.json')
      expect(diagnosticsHead.headers.get('content-disposition'))
        .toContain('computer-history-diagnostics-2026-10-05.json')
    } finally {
      vi.useRealTimers()
      if (previousTz === undefined) delete process.env.TZ
      else process.env.TZ = previousTz
    }
  })

  it('accepts bounded recent and search queries without silently coercing them', async () => {
    const { calls, request } = harness()

    expect((await request(
      '/recent?sinceMs=12&limit=50&workspaceId=alpha',
    )).status).toBe(200)
    expect(calls.recent).toEqual({
      sinceMs: 12,
      workspaceId: 'alpha',
      limit: 50,
    })

    expect((await request(
      '/search?q=provider.ts&sinceMs=10&untilMs=20&limit=100'
      + '&workspaceId=alpha&bundleId=com.microsoft.VSCode',
    )).status).toBe(200)
    expect(calls.search).toEqual({
      query: 'provider.ts',
      sinceMs: 10,
      untilMs: 20,
      workspaceId: 'alpha',
      bundleId: 'com.microsoft.VSCode',
      limit: 100,
    })
  })

  it('returns 400 for malformed or out-of-range query parameters', async () => {
    const { request } = harness()
    const invalid = [
      '/recent?limit=0',
      '/recent?limit=101',
      '/recent?limit=abc',
      '/recent?sinceMs=-1',
      '/recent?workspaceId=',
      '/search?q=',
      '/search?q=x&sinceMs=20&untilMs=10',
      '/search?q=x&bundleId=' + 'x'.repeat(513),
    ]

    const responses = await Promise.all(
      invalid.map(suffix => request(suffix)),
    )
    responses.forEach((response, index) => {
      const suffix = invalid[index]!
      expect(response.status, suffix).toBe(400)
      expect(response.headers.get('cache-control'), suffix)
        .toBe('no-store')
    })
  })

  it('returns one exact stored work thread and validates its key', async () => {
    const detail = {
      thread: {
        threadKey: 'workspace:alpha',
        episodeIds: ['episode:1'],
        episodeCount: 1,
        startedAtMs: 1,
        endedAtMs: 2,
        workspaceTitle: 'alpha',
        resources: [],
        summary: 'one episode',
        summaryObservationIds: [],
      },
      timeline: [],
    }
    const { calls, request } = harness({
      async thread(input: unknown) {
        calls.thread = input
        return detail
      },
    })

    const response = await request('/thread?threadKey=workspace%3Aalpha')
    expect(response.status).toBe(200)
    expect(calls.thread).toEqual({ threadKey: 'workspace:alpha' })
    await expect(response.json()).resolves.toEqual(detail)

    expect((await request('/thread')).status).toBe(400)
    expect((await request('/thread?threadKey=')).status).toBe(400)
    expect((await request('/thread?threadKey=' + 'x'.repeat(2_049))).status).toBe(400)
  })

  it('returns 404 for an unknown work thread', async () => {
    const { request } = harness()
    expect((await request('/thread?threadKey=workspace%3Aunknown')).status).toBe(404)
  })

  it('distinguishes missing and unknown episodes', async () => {
    const { request } = harness()
    const missing = await request('/episode')
    expect(missing.status).toBe(400)

    const unknown = await request('/episode?id=episode%3Aunknown')
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('cache-control')).toBe('no-store')
  })



  it('opens only resources that belong to the named stored episode', async () => {
    const storedUri = new URL('../../package.json', import.meta.url).href
    const episode = {
      id: 'episode:open',
      startedAtMs: 1,
      endedAtMs: 2,
      boundary: { startReason: 'first-observation', endReason: 'timeout' },
      summaryKind: 'deterministic',
      summary: 'work',
      summaryObservationIds: ['observation:1'],
      lastStrongResource: {
        kind: 'file',
        canonicalUri: storedUri,
        displayLabel: 'report.md',
      },
      resources: [{
        kind: 'file',
        canonicalUri: storedUri,
        displayLabel: 'report.md',
        firstSeenAtMs: 1,
        lastSeenAtMs: 2,
        observationCount: 1,
      }],
      surfaces: [{
        bundleId: 'com.microsoft.VSCode',
        surfaceKind: 'editor',
        firstSeenAtMs: 1,
        lastSeenAtMs: 2,
        observationCount: 1,
      }],
      confidence: 1,
      state: 'closed',
      observationIds: ['observation:1'],
    }
    const api = harness({ getEpisode: async () => episode })

    const capability = await api.request('/resume/open')
    expect(capability.status).toBe(200)
    await expect(capability.json()).resolves.toMatchObject({ available: true })

    const opened = await api.request('/resume/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId: 'episode:open',
        resourceCanonicalUri: storedUri,
      }),
    })
    expect(opened.status).toBe(200)
    await expect(opened.json()).resolves.toMatchObject({
      status: 'opened',
      kind: 'file',
    })

    const forged = await api.request('/resume/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId: 'episode:open',
        resourceCanonicalUri: 'file:///tmp/not-recorded.txt',
      }),
    })
    expect(forged.status).toBe(400)
  })

  it('maps capture ownership conflicts and collector failures explicitly', async () => {
    const conflict = harness({
      pause: async () => {
        throw new Error(
          'computer history capture is owned by another DSH Host',
        )
      },
    })
    expect((await conflict.request('/pause', {
      method: 'POST',
    })).status).toBe(409)

    const recoverConflict = harness({
      recover: async () => {
        throw new Error(
          'computer history capture is owned by another DSH Host',
        )
      },
    })
    expect((await recoverConflict.request('/recover', {
      method: 'POST',
    })).status).toBe(409)

    const unavailable = harness({
      resume: async () => {
        throw new Error('collector did not acknowledge running')
      },
    })
    expect((await unavailable.request('/resume', {
      method: 'POST',
    })).status).toBe(503)
  })

  it('validates policy bodies and maps ownership conflicts', async () => {
    const { request } = harness()
    expect((await request('/policy', {
      method: 'POST',
      body: '{',
    })).status).toBe(400)
    expect((await request('/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'exclude', rules: [] }),
    })).status).toBe(400)

    const conflict = harness({
      replacePolicy: async () => {
        throw new Error(
          'capture policy is owned by another DSH Host',
        )
      },
    })
    const response = await conflict.request('/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'include-only',
        rules: [],
      }),
    })
    expect(response.status).toBe(409)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('validates delete requests and sanitizes internal failures', async () => {
    const { request } = harness()
    expect((await request('/delete', {
      method: 'POST',
      body: '{',
    })).status).toBe(400)
    expect((await request('/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: { kind: 'time-range', startMs: 20, endMs: 10 },
      }),
    })).status).toBe(400)

    const failing = harness({
      delete: async () => {
        throw new Error('secret database detail')
      },
    })
    const response = await failing.request('/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { kind: 'all' } }),
    })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Deletion failed.')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
