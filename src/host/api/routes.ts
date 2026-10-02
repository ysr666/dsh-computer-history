import '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import { EpisodeId } from '../../shared/index.js'
import {
  parseDeleteRequest,
  parsePolicyUpdate,
} from './validation.js'

export const HISTORY_API_PREFIX = '/api/computer-history'

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

class RequestValidationError extends Error {}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function optionalQueryInteger(
  url: URL,
  name: string,
  min: number,
  max: number,
): number | undefined {
  const raw = url.searchParams.get(name)
  if (raw === null) return undefined
  if (!/^\d+$/.test(raw)) {
    throw new RequestValidationError(`${name} must be an integer`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RequestValidationError(
      `${name} must be between ${min} and ${max}`,
    )
  }
  return value
}

function optionalQueryText(
  url: URL,
  name: string,
  maxLength: number,
): string | undefined {
  const value = url.searchParams.get(name)
  if (value === null) return undefined
  if (value.length === 0 || value.length > maxLength) {
    throw new RequestValidationError(
      `${name} must contain 1..${maxLength} characters`,
    )
  }
  return value
}

function requiredQueryText(
  url: URL,
  name: string,
  maxLength: number,
): string {
  const value = optionalQueryText(url, name, maxLength)?.trim()
  if (!value) {
    throw new RequestValidationError(`Missing ${name}.`)
  }
  return value
}

function requestFailure(error: unknown): Response {
  if (error instanceof RequestValidationError) {
    return textResponse(error.message, 400)
  }
  return textResponse('Request failed.', 500)
}

export function registerHistoryApi(ctx: Context): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/state',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => {
      try {
        return Promise.resolve(json(ctx.computerHistory.getState()))
      } catch {
        return Promise.resolve(textResponse('Request failed.', 500))
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/recent',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      try {
        const url = new URL(request.url)
        const sinceMs = optionalQueryInteger(
          url,
          'sinceMs',
          0,
          Number.MAX_SAFE_INTEGER,
        )
        const limit = optionalQueryInteger(url, 'limit', 1, 100)
        const workspaceId = optionalQueryText(url, 'workspaceId', 1_000)
        return json(await ctx.computerHistory.recent({
          ...(sinceMs === undefined ? {} : { sinceMs }),
          ...(workspaceId === undefined ? {} : { workspaceId }),
          ...(limit === undefined ? {} : { limit }),
        }, request.signal))
      } catch (error) {
        return requestFailure(error)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/episode',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      try {
        const id = requiredQueryText(
          new URL(request.url),
          'id',
          1_000,
        )
        const episode = await ctx.computerHistory.getEpisode(
          EpisodeId(id),
          request.signal,
        )
        return episode
          ? json(episode)
          : textResponse('Not found.', 404)
      } catch (error) {
        return requestFailure(error)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/search',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      try {
        const url = new URL(request.url)
        const query = requiredQueryText(url, 'q', 500)
        const sinceMs = optionalQueryInteger(
          url,
          'sinceMs',
          0,
          Number.MAX_SAFE_INTEGER,
        )
        const untilMs = optionalQueryInteger(
          url,
          'untilMs',
          0,
          Number.MAX_SAFE_INTEGER,
        )
        if (
          sinceMs !== undefined
          && untilMs !== undefined
          && untilMs <= sinceMs
        ) {
          throw new RequestValidationError(
            'untilMs must be greater than sinceMs',
          )
        }
        const limit = optionalQueryInteger(url, 'limit', 1, 100)
        const workspaceId = optionalQueryText(url, 'workspaceId', 1_000)
        const bundleId = optionalQueryText(url, 'bundleId', 512)
        return json(await ctx.computerHistory.search({
          query,
          ...(sinceMs === undefined ? {} : { sinceMs }),
          ...(untilMs === undefined ? {} : { untilMs }),
          ...(workspaceId === undefined ? {} : { workspaceId }),
          ...(bundleId === undefined ? {} : { bundleId }),
          ...(limit === undefined ? {} : { limit }),
        }, request.signal))
      } catch (error) {
        return requestFailure(error)
      }
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
        try {
          await action()
          return json(ctx.computerHistory.getState())
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          if (
            message === 'computer history capture is disabled'
            || message === 'computer history capture is owned by another DSH Host'
          ) {
            return textResponse(message, 409)
          }
          if (
            message === 'computer history capture is unavailable on this DSH Host'
          ) {
            return textResponse(message, 503)
          }
          return textResponse('Capture control failed.', 503)
        }
      },
    }))
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/policy',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      if (request.method === 'GET') {
        try {
          return json(ctx.computerHistory.getPolicy())
        } catch {
          return textResponse('Request failed.', 500)
        }
      }
      let body: unknown
      try { body = await request.json() } catch {
        return textResponse('Invalid JSON.', 400)
      }
      let update
      try {
        update = parsePolicyUpdate(body)
      } catch (error) {
        return textResponse(
          error instanceof Error
            ? error.message
            : 'Invalid policy update.',
          400,
        )
      }
      try {
        return json(
          await ctx.computerHistory.replacePolicy(update),
        )
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Policy update failed.'
        if (message.startsWith('Phase 1')) {
          return textResponse(message, 400)
        }
        if (message === 'capture policy is owned by another DSH Host') {
          return textResponse(message, 409)
        }
        return textResponse('Policy update failed.', 500)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/delete',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      let body: unknown
      try { body = await request.json() } catch {
        return textResponse('Invalid JSON.', 400)
      }
      let deletion
      try {
        deletion = parseDeleteRequest(body)
      } catch (error) {
        return textResponse(
          error instanceof Error
            ? error.message
            : 'Invalid deletion request.',
          400,
        )
      }
      try {
        return json(
          await ctx.computerHistory.delete(
            deletion,
            request.signal,
          ),
        )
      } catch {
        return textResponse('Deletion failed.', 500)
      }
    },
  }))
}
