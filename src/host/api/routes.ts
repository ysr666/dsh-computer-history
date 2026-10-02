import '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import { EpisodeId } from '../../shared/index.js'
import {
  parseDeleteRequest,
  parsePolicyUpdate,
} from './validation.js'
import { HistoryImportError } from '../audit/export.js'
import { RetentionSettingsError } from '../store/retention-settings.js'
import { SummaryProviderError } from '../semantic/provider.js'
import { computerHistoryService } from '../service/index.js'

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
  const history = computerHistoryService(ctx)

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/state',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => {
      try {
        return Promise.resolve(json(history.getState()))
      } catch {
        return Promise.resolve(textResponse('Request failed.', 500))
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/retention',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => Promise.resolve(json(history.retention())),
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/retention',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return textResponse('Invalid JSON.', 400)
      }
      const candidate = body as Partial<{
        observationRetentionHours: number
        episodeRetentionDays: number
      }>
      if (
        typeof candidate?.observationRetentionHours !== 'number'
        || typeof candidate?.episodeRetentionDays !== 'number'
      ) {
        return textResponse(
          'observationRetentionHours and episodeRetentionDays are required',
          400,
        )
      }
      try {
        return json(history.setRetention({
          observationRetentionHours: candidate.observationRetentionHours,
          episodeRetentionDays: candidate.episodeRetentionDays,
        }))
      } catch (error) {
        if (error instanceof RetentionSettingsError) {
          return textResponse(error.message, 400)
        }
        return textResponse('Request failed.', 500)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/timeline',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      try {
        const url = new URL(request.url)
        const days = optionalQueryInteger(url, 'days', 1, 31)
        const timeline = await history.timeline(
          days === undefined ? {} : { days },
        )
        return json(timeline)
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return textResponse(error.message, 400)
        }
        return textResponse('Request failed.', 500)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    // "What would you not keep?": the same predicates ingestion uses, run over
    // rows that are already stored.
    path: HISTORY_API_PREFIX + '/audit/preview',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request: Request) => {
      const scopeKey = new URL(request.url).searchParams.get('scope') ?? ''
      if (!/^(app|workspace):.+/.test(scopeKey)) {
        return Promise.resolve(
          textResponse('scope must be app:<bundleId> or workspace:<id>', 400),
        )
      }
      try {
        return Promise.resolve(json(history.redactionPreview({ scopeKey })))
      } catch {
        return Promise.resolve(textResponse('Request failed.', 500))
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    // "What do you know about me": one JSON document that this Host can read
    // back. The pairing token digest is not part of it (see audit/export.ts).
    path: HISTORY_API_PREFIX + '/export',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => Promise.resolve(json(history.exportAll())),
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/import',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return textResponse('Invalid JSON.', 400)
      }
      try {
        return json(history.importAll(body))
      } catch (error) {
        if (error instanceof HistoryImportError) {
          return textResponse(error.message, 400)
        }
        return textResponse('Import failed.', 500)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/semantic',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => Promise.resolve(json(history.semanticState())),
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    // The payload preview ADR 0004 §4 requires before a remote opt-in: exactly
    // what would be sent, computed by the same minimiser the provider uses.
    path: HISTORY_API_PREFIX + '/semantic/preview',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request: Request) => {
      const scopeKey = new URL(request.url).searchParams.get('scope') ?? ''
      try {
        const preview = history.semanticPreview({ scopeKey })
        return Promise.resolve(preview === undefined
          ? textResponse('No episode matches that scope yet.', 404)
          : json(preview))
      } catch (error) {
        if (error instanceof SummaryProviderError) {
          return Promise.resolve(textResponse(error.message, 400))
        }
        return Promise.resolve(textResponse('Request failed.', 500))
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/semantic/opt-in',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return textResponse('Invalid JSON.', 400)
      }
      const record = body as Partial<{
        scopeKey: unknown
        providerKind: unknown
        model: unknown
      }>
      if (
        typeof record.scopeKey !== 'string'
        || (record.providerKind !== 'local' && record.providerKind !== 'remote')
      ) {
        return textResponse('scopeKey and providerKind are required.', 400)
      }
      try {
        return json(history.grantSemanticOptIn({
          scopeKey: record.scopeKey,
          providerKind: record.providerKind,
          ...(typeof record.model === 'string' ? { model: record.model } : {}),
        }))
      } catch (error) {
        if (error instanceof SummaryProviderError) {
          return textResponse(error.message, 400)
        }
        return textResponse('Request failed.', 500)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/semantic/revoke',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return textResponse('Invalid JSON.', 400)
      }
      const scopeKey = (body as { scopeKey?: unknown }).scopeKey
      if (typeof scopeKey !== 'string') {
        return textResponse('scopeKey is required.', 400)
      }
      try {
        return json(history.revokeSemanticOptIn({ scopeKey }))
      } catch (error) {
        if (error instanceof SummaryProviderError) {
          return textResponse(error.message, 400)
        }
        return textResponse('Request failed.', 500)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    // `/resume` resumes *capture*; the hint that answers "where was I" is a
    // different question and gets its own route.
    path: HISTORY_API_PREFIX + '/resume-hint',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return textResponse('Invalid JSON.', 400)
      }
      const record = body as Partial<{
        query: unknown
        nowMs: unknown
        currentWorkspaceId: unknown
        turn: unknown
      }>
      if (typeof record.query !== 'string' || record.query.trim().length === 0) {
        return textResponse('A query is required.', 400)
      }
      try {
        const resolution = await history.resolveResume({
          query: record.query,
          nowMs: typeof record.nowMs === 'number' ? record.nowMs : Date.now(),
          ...(typeof record.currentWorkspaceId === 'string'
            ? { currentWorkspaceId: record.currentWorkspaceId }
            : {}),
          turn: typeof record.turn === 'number' ? record.turn : 1,
          source: 'tool',
        })
        return json(resolution)
      } catch {
        return textResponse('Request failed.', 500)
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/threads',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      try {
        const url = new URL(request.url)
        const limit = optionalQueryInteger(url, 'limit', 5, 100)
        // `threads` is async: handing the promise to json() would serialise
        // as {} and look like an empty list.
        const threads = await history.threads(
          limit === undefined ? {} : { limit },
        )
        return json(threads)
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return Promise.resolve(textResponse(error.message, 400))
        }
        return Promise.resolve(textResponse('Request failed.', 500))
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/pairing',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => {
      try {
        return Promise.resolve(json(history.pairing()))
      } catch {
        return Promise.resolve(textResponse('Request failed.', 500))
      }
    },
  }))

  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_API_PREFIX + '/pairing/rotate',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: () => {
      try {
        // The token is returned once and never stored in clear: the response
        // must not be cached anywhere between here and the panel.
        return Promise.resolve(json(history.rotatePairing()))
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (message === 'companion pairing is unavailable') {
          return Promise.resolve(textResponse(message, 503))
        }
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
        return json(await history.recent({
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
        const episode = await history.getEpisode(
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
        return json(await history.search({
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
    ['/pause', () => history.pause()],
    ['/resume', () => history.resume()],
  ] as const) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: HISTORY_API_PREFIX + suffix,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          await action()
          return json(history.getState())
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
          return json(history.getPolicy())
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
          await history.replacePolicy(update),
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
          await history.delete(
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
