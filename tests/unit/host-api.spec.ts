import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
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
    async pause() {},
    async resume() {},
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
    connection: {
      fetch: {
        register(route: RegisteredRoute) {
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
      '/api/computer-history/delete',
      '/api/computer-history/episode',
      '/api/computer-history/pause',
      '/api/computer-history/policy',
      '/api/computer-history/recent',
      '/api/computer-history/resume',
      '/api/computer-history/search',
      '/api/computer-history/state',
    ])

    const response = await request('/state')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
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

  it('distinguishes missing and unknown episodes', async () => {
    const { request } = harness()
    const missing = await request('/episode')
    expect(missing.status).toBe(400)

    const unknown = await request('/episode?id=episode%3Aunknown')
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('cache-control')).toBe('no-store')
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
