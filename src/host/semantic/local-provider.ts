import {
  assertLoopbackEndpoint,
  SummaryProviderError,
  type SummaryProvider,
  type SummaryRequest,
} from './provider.js'

export interface LocalProviderOptions {
  /** Ollama-compatible generate endpoint, e.g. http://127.0.0.1:11434. */
  readonly endpoint: string
  readonly model: string
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 20_000

/**
 * A model on this machine (ADR 0004 §3). Nothing here can reach the network:
 * the endpoint is checked to be loopback before the first byte is sent, and
 * that check lives in `assertLoopbackEndpoint` rather than in a comment.
 *
 * The prompt is built from the minimised payload only. If it ever contained a
 * title, a path or a URL, `verify:semantic-boundary` and the payload tests would
 * say so.
 */
export class LocalSummaryProvider implements SummaryProvider {
  public readonly kind = 'local' as const
  public readonly endpoint: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  public constructor(options: LocalProviderOptions) {
    const url = assertLoopbackEndpoint(options.endpoint)
    this.endpoint = url.origin
    this.model = options.model
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  public async summarise(request: SummaryRequest): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          prompt: buildPrompt(request),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new SummaryProviderError(
          `local provider answered ${response.status}`,
        )
      }
      const body = await response.json() as { response?: unknown }
      if (typeof body.response !== 'string' || body.response.length === 0) {
        throw new SummaryProviderError('local provider returned no summary')
      }
      return body.response.trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

export function buildPrompt(request: SummaryRequest): string {
  return [
    'Summarise this work episode in one sentence. It describes shape only:',
    'no file names, titles or addresses are included, so do not invent them.',
    JSON.stringify(request.payload),
  ].join('\n')
}
