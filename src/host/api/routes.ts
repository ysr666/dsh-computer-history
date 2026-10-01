import '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import { EpisodeId } from '../../shared/index.js'

export const HISTORY_API_PREFIX = '/api/computer-history'

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function integer(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

export function registerHistoryApi(ctx: Context): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/state',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => Promise.resolve(json(ctx.computerHistory.getState())),
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/recent',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      const sinceMs = integer(url.searchParams.get('sinceMs'))
      const limit = integer(url.searchParams.get('limit'))
      return json(await ctx.computerHistory.recent({
        ...(sinceMs === undefined ? {} : { sinceMs }),
        ...(url.searchParams.get('workspaceId')
          ? { workspaceId: url.searchParams.get('workspaceId')! }
          : {}),
        ...(limit === undefined ? {} : { limit }),
      }, request.signal))
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/episode',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return new Response('Missing episode id.', { status: 400 })
      const episode = await ctx.computerHistory.getEpisode(
        EpisodeId(id),
        request.signal,
      )
      return episode ? json(episode) : new Response('Not found.', { status: 404 })
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/search',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      const query = url.searchParams.get('q')
      if (!query) return new Response('Missing query.', { status: 400 })
      const limit = integer(url.searchParams.get('limit'))
      return json(await ctx.computerHistory.search({
        query,
        ...(url.searchParams.get('workspaceId')
          ? { workspaceId: url.searchParams.get('workspaceId')! }
          : {}),
        ...(url.searchParams.get('bundleId')
          ? { bundleId: url.searchParams.get('bundleId')! }
          : {}),
        ...(limit === undefined ? {} : { limit }),
      }, request.signal))
    },
  }))

  for (const [suffix, action] of [
    ['/pause', () => ctx.computerHistory.pause()],
    ['/resume', () => ctx.computerHistory.resume()],
  ] as const) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: HISTORY_API_PREFIX + suffix,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => {
        await action()
        return json(ctx.computerHistory.getState())
      },
    }))
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/policy',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      if (request.method === 'GET') {
        return json(ctx.computerHistory.getPolicy())
      }
      let body: unknown
      try { body = await request.json() } catch {
        return new Response('Invalid JSON.', { status: 400 })
      }
      if (!body || typeof body !== 'object' || !('mode' in body) || !('rules' in body)) {
        return new Response('Invalid policy update.', { status: 400 })
      }
      return json(await ctx.computerHistory.replacePolicy(
        body as Parameters<typeof ctx.computerHistory.replacePolicy>[0],
      ))
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/delete',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      let body: unknown
      try { body = await request.json() } catch {
        return new Response('Invalid JSON.', { status: 400 })
      }
      if (!body || typeof body !== 'object' || !('scope' in body)) {
        return new Response('Invalid deletion request.', { status: 400 })
      }
      return json(await ctx.computerHistory.delete(
        body as Parameters<typeof ctx.computerHistory.delete>[0],
        request.signal,
      ))
    },
  }))
}
