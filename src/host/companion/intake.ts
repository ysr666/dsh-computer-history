import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { CompanionTokenStore } from './token-store.js'

/** What the extension reports for one tab event (metadata only, ADR 0002). */
export interface CompanionPayload {
  readonly origin: string
  readonly path: string
  readonly title?: string
  readonly incognito: boolean
  readonly browserSession: string
  readonly seq: number
  readonly observedAtMs: number
}

export interface CompanionIntakeOptions {
  readonly tokens: CompanionTokenStore
  /** Store the observation; returns whether anything was persisted. */
  readonly deliver: (payload: CompanionPayload) => Promise<boolean> | boolean
  readonly port?: number
  readonly host?: string
  readonly maxBodyBytes?: number
  readonly rateLimitPerMinute?: number
  readonly now?: () => number
  readonly truncateTitleAt?: number
}

export class CompanionIntakeError extends Error {}

const DEFAULT_PORT = 19388
const DEFAULT_MAX_BODY = 8 * 1024
const DEFAULT_RATE_LIMIT = 120

/**
 * The companion's own intake (ADR 0007).
 *
 * It cannot live on the DSH webserver: those routes sit behind the session auth
 * an extension cannot present. This listener binds loopback only, requires the
 * pairing token, caps the body and the rate, and refuses incognito payloads
 * host-side as well as in the extension.
 */
export class CompanionIntake {
  private server: Server | undefined
  private boundPort: number | undefined
  private readonly hits = new Map<string, number[]>()
  private readonly maxBody: number
  private readonly rateLimit: number
  private readonly configuredPort: number
  private readonly host: string
  private readonly truncateTitleAt: number
  private readonly now: () => number

  public constructor(private readonly options: CompanionIntakeOptions) {
    this.configuredPort = options.port ?? DEFAULT_PORT
    this.host = options.host ?? '127.0.0.1'
    this.maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY
    this.rateLimit = options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT
    this.truncateTitleAt = options.truncateTitleAt ?? 1024
    this.now = options.now ?? (() => Date.now())
  }

  public get port(): number | undefined {
    return this.boundPort
  }

  /** Resolves with the bound port; rejects when the port is unavailable. */
  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handle(request, response)
      })
      server.on('error', (error: NodeJS.ErrnoException) => {
        this.server = undefined
        this.boundPort = undefined
        reject(new CompanionIntakeError(
          error.code === 'EADDRINUSE'
            ? `companion intake port ${this.configuredPort} is already in use`
            : `companion intake failed: ${error.message}`,
        ))
      })
      server.listen(this.configuredPort, this.host, () => {
        const address = server.address()
        this.server = server
        this.boundPort = typeof address === 'object' && address
          ? address.port
          : this.configuredPort
        resolve(this.boundPort)
      })
    })
  }

  public async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.boundPort = undefined
    if (!server) return
    await new Promise<void>(resolve => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = request.url ?? '/'
    const isObservation =
      request.method === 'POST' && url === '/companion/observation'
    const isHealth =
      request.method === 'GET' && url === '/companion/health'
    if (!isObservation && !isHealth) {
      return this.send(response, 404, { error: 'not found' })
    }

    // DNS rebinding: a page on another host must not be able to reach a
    // loopback listener through a name that resolves here.
    const hostHeader = String(request.headers.host ?? '')
    const allowed = new Set([
      `127.0.0.1:${this.boundPort ?? this.configuredPort}`,
      `localhost:${this.boundPort ?? this.configuredPort}`,
    ])
    if (!allowed.has(hostHeader)) {
      return this.send(response, 403, { error: 'unexpected host' })
    }

    const token = request.headers['x-companion-token']
    const presented = Array.isArray(token) ? token[0] : token
    if (!this.options.tokens.verify(presented)) {
      return this.send(response, 401, { error: 'pairing token required' })
    }

    // Pairing check for the options page: proves the port and the token before
    // the user trusts a pairing, and stores nothing.
    if (isHealth) {
      return this.send(response, 200, { ok: true, port: this.boundPort })
    }

    if (!this.withinRate(presented ?? '')) {
      return this.send(response, 429, { error: 'rate limit exceeded' })
    }

    let body: string
    try {
      body = await this.readBody(request)
    } catch (error) {
      if (error instanceof CompanionIntakeError) {
        // Answer before closing: destroying the socket first turns the 413
        // into a client-side "socket hang up", which is not an error the
        // extension (or its user) can act on.
        this.send(response, 413, { error: 'body too large' })
        request.destroy()
        return
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return this.send(response, 400, { error: 'malformed json' })
    }

    const payload = this.validate(parsed)
    if (typeof payload === 'string') {
      return this.send(response, 400, { error: payload })
    }

    // Defence in depth: the extension refuses private windows itself, and the
    // Host refuses them again rather than trusting the extension.
    if (payload.incognito) {
      return this.send(response, 403, { error: 'incognito tabs are never reported' })
    }

    const stored = await this.options.deliver(payload)
    return this.send(response, stored ? 201 : 202, { stored })
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let size = 0
      let overflowed = false
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => {
        if (overflowed) return
        size += chunk.length
        if (size > this.maxBody) {
          // Stop buffering and report the failure; the caller writes the
          // response and only then closes the connection.
          overflowed = true
          chunks.length = 0
          reject(new CompanionIntakeError('body too large'))
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => {
        if (!overflowed) resolve(Buffer.concat(chunks).toString('utf8'))
      })
      request.on('error', error => {
        if (!overflowed) reject(error)
      })
    })
  }

  private withinRate(token: string): boolean {
    const nowMs = this.now()
    const windowStart = nowMs - 60_000
    const recent = (this.hits.get(token) ?? []).filter(
      stamp => stamp > windowStart,
    )
    if (recent.length >= this.rateLimit) {
      this.hits.set(token, recent)
      return false
    }
    recent.push(nowMs)
    this.hits.set(token, recent)
    return true
  }

  private validate(value: unknown): CompanionPayload | string {
    if (typeof value !== 'object' || value === null) return 'payload required'
    const record = value as Record<string, unknown>

    const origin = record.origin
    if (typeof origin !== 'string' || !/^https?:\/\/[^/?#]+$/.test(origin)) {
      return 'origin must be an http(s) origin without a path'
    }
    const path = record.path
    if (typeof path !== 'string' || !path.startsWith('/')) {
      return 'path must start with /'
    }
    const browserSession = record.browserSession
    if (typeof browserSession !== 'string' || browserSession.length === 0) {
      return 'browserSession required'
    }
    const seq = record.seq
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) {
      return 'seq must be a positive integer'
    }
    const observedAtMs = record.observedAtMs
    if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs)) {
      return 'observedAtMs must be a number'
    }
    if (record.incognito !== true && record.incognito !== false) {
      return 'incognito must be a boolean'
    }
    const title = typeof record.title === 'string'
      ? record.title.slice(0, this.truncateTitleAt)
      : undefined

    return {
      origin,
      path,
      ...(title === undefined ? {} : { title }),
      incognito: record.incognito,
      browserSession,
      seq,
      observedAtMs,
    }
  }

  private send(
    response: ServerResponse,
    status: number,
    body: Record<string, unknown>,
  ): void {
    const text = JSON.stringify(body)
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    })
    response.end(text)
  }
}
