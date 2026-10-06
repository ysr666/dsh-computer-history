import { createHash } from 'node:crypto'
import type { MinimisedSummaryPayload, ObservationId } from '../../shared/index.js'
import {
  assertRemoteOptIn,
  type SemanticOptInStore,
} from './opt-in.js'
import {
  SummaryProviderError,
  type SummaryProvider,
  type SummaryRequest,
} from './provider.js'

/**
 * What left the machine, recorded so the audit can answer "what, where, when"
 * (ADR 0010). The digest is of the bytes the Host actually sent.
 */
export interface RemoteSendRecord {
  readonly endpointHost: string
  readonly model: string
  readonly sentAtMs: number
  readonly payloadDigest: string
}

export interface RemoteSummaryProviderOptions {
  readonly endpoint: string
  readonly model: string
  readonly optIns: SemanticOptInStore
  /** Injected in tests; the real one is global fetch. */
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
  readonly now?: () => number
  /**
   * Called once a Response exists, before response/status/body validation.
   * At that point the request definitely reached an HTTP peer, so a rejected
   * response must still remain visible in the "what left this machine" audit.
   */
  readonly onSent?: (record: RemoteSendRecord) => void
}

interface RemoteResponse {
  readonly summary: unknown
  readonly citations: unknown
}

/**
 * The exact bytes a remote call sends. The preview and the provider both call
 * this, so "the preview shows what would be sent" is a property of the code
 * rather than a promise in a document (ADR 0010).
 */
export function buildRemoteRequestBody(input: {
  readonly model: string
  readonly payload: MinimisedSummaryPayload
  readonly observationIds: readonly ObservationId[]
}): string {
  return JSON.stringify({
    model: input.model,
    payload: input.payload,
    // Opaque internal integers, needed so the response can cite precisely.
    observationIds: [...input.observationIds],
  })
}

/**
 * A model that runs somewhere else (ADR 0010).
 *
 * Four rules are structural rather than conventional:
 *  - the recorded per-scope opt-in is checked **before anything else**, so a
 *    scope the user has not enabled performs no network call at all;
 *  - the endpoint must be https - a remote provider has no business on a
 *    plaintext transport;
 *  - the request body is the minimised payload and nothing else: no path, no
 *    URL, no title, no file name beyond an extension;
 *  - the response must cite observations **from the set this call sent**. A
 *    citation the Host cannot check is worse than no summary (ADR 0004 §5).
 *
 * There is deliberately **no retry**. A retry silently multiplies the copies
 * that have already left the machine.
 */
export class RemoteSummaryProvider implements SummaryProvider {
  public readonly kind = 'remote' as const
  public readonly endpoint: string

  public constructor(
    private readonly options: RemoteSummaryProviderOptions,
  ) {
    this.endpoint = options.endpoint
  }

  public async summarise(request: SummaryRequest): Promise<string> {
    // 1) the gate. Nothing below runs without a recorded opt-in, and that
    //    includes building a request.
    assertRemoteOptIn(this.options.optIns, request.scope)

    const url = this.requireHttpsEndpoint()
    const body = buildRemoteRequestBody({
      model: this.options.model,
      payload: request.payload,
      observationIds: request.citations,
    })
    const digest = createHash('sha256').update(body).digest('hex')
    const sentAtMs = (this.options.now ?? Date.now)()
    const doFetch = this.options.fetchImpl ?? fetch
    const timeoutMs = this.options.timeoutMs ?? 20_000

    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      })
    } catch (error) {
      // Reported, never retried.
      throw new SummaryProviderError(
        `remote summary request failed: ${(error as Error).message}`,
      )
    } finally {
      clearTimeout(timer)
    }

    // A response is proof that the request left this Host. Record that
    // before judging whether the remote side returned a usable summary: a 500,
    // malformed JSON, an empty summary or bad citations do not unsend bytes.
    this.options.onSent?.({
      endpointHost: url.host,
      model: this.options.model,
      sentAtMs,
      payloadDigest: digest,
    })

    if (!response.ok) {
      throw new SummaryProviderError(
        `remote summary endpoint answered ${response.status}`,
      )
    }

    let parsed: RemoteResponse
    try {
      parsed = await response.json() as RemoteResponse
    } catch {
      throw new SummaryProviderError('remote summary endpoint returned invalid JSON')
    }

    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    if (summary.length === 0) {
      throw new SummaryProviderError('remote summary was empty')
    }
    this.assertCitations(parsed.citations, request.citations)

    return summary
  }

  private requireHttpsEndpoint(): URL {
    let url: URL
    try {
      url = new URL(this.options.endpoint)
    } catch {
      throw new SummaryProviderError('remote endpoint is not a valid URL')
    }
    if (url.protocol !== 'https:') {
      throw new SummaryProviderError('remote endpoint must use https')
    }
    return url
  }

  /**
   * Every citation must name an observation this call sent. A response that
   * cites anything else is refused whole, because the Host cannot check it.
   */
  private assertCitations(
    value: unknown,
    sent: readonly ObservationId[],
  ): void {
    if (!Array.isArray(value) || value.length === 0) {
      throw new SummaryProviderError(
        'remote summary must cite the observations it was given',
      )
    }
    const allowed = new Set(sent.map(id => Number(id)))
    for (const citation of value) {
      if (typeof citation !== 'number' || !allowed.has(citation)) {
        throw new SummaryProviderError(
          `remote summary cited an observation it was not given: ${String(citation)}`,
        )
      }
    }
  }
}

/** The minimised shape, for the preview and for documentation. */
export type { MinimisedSummaryPayload }
