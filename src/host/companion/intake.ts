import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { CompanionTokenStore } from './token-store.js'

/** What the extension reports for one tab event (metadata only, ADR 0002). */
export interface BrowserCompanionPayload {
  readonly source: 'browser'
  readonly origin: string
  readonly path: string
  readonly title?: string
  readonly incognito: boolean
  readonly browserSession: string
  readonly seq: number
  readonly observedAtMs: number
}

/**
 * An editor's own answer about where work is happening (ADR 0009).
 *
 * There is deliberately no field for a document body, a selection, a
 * decoration or a UI string: contents are unrepresentable here rather than
 * merely unsent, and `validate` refuses unknown fields instead of ignoring
 * them, so a payload that tries to carry text is rejected at the boundary.
 */
export interface EditorCompanionPayload {
  readonly source: 'editor'
  /**
   * The application this extension declares it is (ADR 0011). It is a **claim**,
   * not something the operating system observed: the Host validates its shape,
   * records it as a claim, and lets the allow-list and the protected set decide
   * exactly as they do for any other observation.
   */
  readonly app: {
    readonly bundleId: string
    readonly name: string
  }
  /** Absolute path. The editor vouches for it, verbatim. */
  readonly workspaceRoot: string
  readonly filePath?: string
  readonly languageId?: string
  readonly surfaceKind?: 'editor' | 'diff' | 'terminal' | 'output'
  readonly title?: string
  readonly editorSession: string
  readonly seq: number
  readonly observedAtMs: number
}

export type CompanionPayload =
  | BrowserCompanionPayload
  | EditorCompanionPayload

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

/** The fields each shape may carry. Anything else is refused, not ignored. */
const BROWSER_FIELDS = new Set([
  'source', 'origin', 'path', 'title', 'incognito', 'browserSession', 'seq',
  'observedAtMs',
])
const EDITOR_FIELDS = new Set([
  'source', 'app', 'workspaceRoot', 'filePath', 'languageId', 'surfaceKind',
  'title', 'editorSession', 'seq', 'observedAtMs',
])

/**
 * A declared identity must look like an application id, and nothing else: a
 * claim that carries whitespace or a sentence is not an identity, it is an
 * attempt to put text somewhere it does not belong.
 */
const DECLARED_BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{2,127}$/

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
    // Host refuses them again rather than trusting the extension. A browser
    // payload is the only shape that has the concept.
    if (payload.source === 'browser' && payload.incognito) {
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

    const source = record.source
    if (source === 'editor') return this.validateEditor(record)
    if (source !== 'browser') {
      return 'source must be "browser" or "editor"'
    }
    for (const key of Object.keys(record)) {
      if (!BROWSER_FIELDS.has(key)) {
        return `unknown field for a browser payload: ${key}`
      }
    }

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
      source: 'browser',
      origin,
      path,
      ...(title === undefined ? {} : { title }),
      incognito: record.incognito,
      browserSession,
      seq,
      observedAtMs,
    }
  }

  /**
   * The editor shape (ADR 0009). Unknown fields are refused, `filePath` must
   * live under the root it claims, and there is no field any document text
   * could travel in.
   */
  private validateEditor(
    record: Record<string, unknown>,
  ): EditorCompanionPayload | string {
    for (const key of Object.keys(record)) {
      if (!EDITOR_FIELDS.has(key)) {
        return `unknown field for an editor payload: ${key}`
      }
    }
    const app = record.app
    if (typeof app !== 'object' || app === null) {
      return 'app is required for an editor payload'
    }
    const claimed = app as Record<string, unknown>
    const bundleId = claimed.bundleId
    if (typeof bundleId !== 'string' || !DECLARED_BUNDLE_ID.test(bundleId)) {
      return 'app.bundleId must look like an application id'
    }
    const declaredName = claimed.name
    if (typeof declaredName !== 'string' || declaredName.trim().length === 0) {
      return 'app.name is required'
    }
    for (const key of Object.keys(claimed)) {
      if (key !== 'bundleId' && key !== 'name') {
        return `unknown field for a declared application: ${key}`
      }
    }

    const workspaceRoot = record.workspaceRoot
    if (
      typeof workspaceRoot !== 'string'
      || !workspaceRoot.startsWith('/')
      || workspaceRoot.includes('\0')
    ) {
      return 'workspaceRoot must be an absolute path'
    }
    const editorSession = record.editorSession
    if (typeof editorSession !== 'string' || editorSession.length === 0) {
      return 'editorSession required'
    }
    const seq = record.seq
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) {
      return 'seq must be a positive integer'
    }
    const observedAtMs = record.observedAtMs
    if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs)) {
      return 'observedAtMs must be a number'
    }
    const rawFilePath = record.filePath
    if (rawFilePath !== undefined && typeof rawFilePath !== 'string') {
      return 'filePath must be a string'
    }
    const filePath = rawFilePath === undefined ? undefined : rawFilePath
    if (filePath !== undefined) {
      if (!filePath.startsWith('/')) return 'filePath must be absolute'
      const root = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`
      if (!filePath.startsWith(root)) {
        return 'filePath must live under workspaceRoot'
      }
    }
    const languageId = record.languageId
    if (languageId !== undefined && typeof languageId !== 'string') {
      return 'languageId must be a string'
    }
    const surfaceKind = record.surfaceKind
    if (
      surfaceKind !== undefined
      && surfaceKind !== 'editor'
      && surfaceKind !== 'diff'
      && surfaceKind !== 'terminal'
      && surfaceKind !== 'output'
    ) {
      return 'surfaceKind must be editor, diff, terminal or output'
    }
    const title = typeof record.title === 'string'
      ? record.title.slice(0, this.truncateTitleAt)
      : undefined

    return {
      source: 'editor',
      app: { bundleId, name: declaredName.slice(0, this.truncateTitleAt) },
      workspaceRoot,
      ...(filePath === undefined ? {} : { filePath }),
      ...(languageId === undefined ? {} : { languageId }),
      ...(surfaceKind === undefined ? {} : { surfaceKind }),
      ...(title === undefined ? {} : { title }),
      editorSession,
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
