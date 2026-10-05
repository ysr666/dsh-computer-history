import { request as httpRequest } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CompanionIntake,
  type CompanionPayload,
} from '../../src/host/companion/intake.js'
import { CompanionTokenStore } from '../../src/host/companion/token-store.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tokenStore(): CompanionTokenStore {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-intake-'))
  roots.push(root)
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  return new CompanionTokenStore(history.db)
}

interface Harness {
  readonly intake: CompanionIntake
  readonly port: number
  readonly delivered: CompanionPayload[]
}

async function harness(
  options: {
    rateLimitPerMinute?: number
    maxBodyBytes?: number
  } = {},
): Promise<Harness> {
  const tokens = tokenStore()
  const browserToken = tokens.rotate('browser', 1_000)
  const editorToken = tokens.rotate('editor', 1_000)
  const delivered: CompanionPayload[] = []
  const intake = new CompanionIntake({
    tokens,
    deliver: (report) => {
      delivered.push(report)
      return true
    },
    port: 0,
    ...options,
  })
  const port = await intake.start()
  // Expose test credentials through the helper, never through the intake class.
  ;(harness as unknown as {
    tokens?: { browser: string; editor: string }
  }).tokens = { browser: browserToken, editor: editorToken }
  return { intake, port, delivered }
}

function currentToken(kind: 'browser' | 'editor' = 'browser'): string {
  return (harness as unknown as {
    tokens?: { browser: string; editor: string }
  }).tokens?.[kind] ?? ''
}

function payload(
  overrides: Partial<Extract<CompanionPayload, { source: 'browser' }>> = {},
): CompanionPayload {
  return {
    source: 'browser',
    origin: 'https://example.test',
    path: '/docs/guide',
    title: 'Example page',
    incognito: false,
    browserSession: 'session-1',
    seq: 1,
    observedAtMs: 10_000,
    ...overrides,
  }
}

function post(
  port: number,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  let kind: 'browser' | 'editor' = 'browser'
  try {
    const parsed = JSON.parse(body) as { source?: unknown }
    if (parsed.source === 'editor') kind = 'editor'
  } catch {
    // Malformed JSON is tested below; browser auth is sufficient to reach parsing.
  }
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/companion/observation',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': currentToken(kind),
        ...headers,
      },
    }, response => {
      let text = ''
      response.on('data', chunk => { text += chunk })
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          json: text ? JSON.parse(text) as Record<string, unknown> : {},
        })
      })
    })
    request.on('error', reject)
    request.end(body)
  })
}

describe('companion intake', () => {
  it('accepts a paired observation and reports it as stored', async () => {
    const { intake, port, delivered } = await harness()
    const response = await post(port, JSON.stringify(payload()))
    expect(response.status).toBe(201)
    expect(response.json).toEqual({ stored: true })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      origin: 'https://example.test',
      path: '/docs/guide',
      seq: 1,
    })
    await intake.stop()
  })

  it('refuses an unpaired or wrong token without delivering', async () => {
    const { intake, port, delivered } = await harness()
    const missing = await post(port, JSON.stringify(payload()), { 'x-companion-token': '' })
    expect(missing.status).toBe(401)
    const wrong = await post(port, JSON.stringify(payload()), { 'x-companion-token': 'nope' })
    expect(wrong.status).toBe(401)
    expect(delivered).toHaveLength(0)
    await intake.stop()
  })

  it('refuses an incognito payload host-side', async () => {
    const { intake, port, delivered } = await harness()
    const response = await post(port, JSON.stringify(payload({ incognito: true })))
    expect(response.status).toBe(403)
    expect(String(response.json.error)).toContain('incognito')
    expect(delivered).toHaveLength(0)
    await intake.stop()
  })

  it('rejects a body over the cap', async () => {
    const { intake, port, delivered } = await harness({ maxBodyBytes: 256 })
    const response = await post(port, JSON.stringify(payload({ title: 'x'.repeat(400) })))
    expect(response.status).toBe(413)
    expect(delivered).toHaveLength(0)
    await intake.stop()
  })

  it('rate limits a token and stops delivering', async () => {
    const { intake, port, delivered } = await harness({ rateLimitPerMinute: 2 })
    expect((await post(port, JSON.stringify(payload()))).status).toBe(201)
    expect((await post(port, JSON.stringify(payload({ seq: 2 })))).status).toBe(201)
    expect((await post(port, JSON.stringify(payload({ seq: 3 })))).status).toBe(429)
    expect(delivered).toHaveLength(2)
    await intake.stop()
  })

  it('answers a pairing health check with the token and nothing without it', async () => {
    const { intake, port } = await harness()
    const ok = await new Promise<{ status: number; json: Record<string, unknown> }>(
      resolve => {
        const request = httpRequest({
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: '/companion/health',
          headers: { 'x-companion-token': currentToken() },
        }, response => {
          let text = ''
          response.on('data', chunk => { text += chunk })
          response.on('end', () => resolve({
            status: response.statusCode ?? 0,
            json: JSON.parse(text) as Record<string, unknown>,
          }))
        })
        request.end()
      },
    )
    expect(ok.status).toBe(200)
    expect(ok.json.ok).toBe(true)
    await intake.stop()
  })

  it('answers 404 for anything but the observation route', async () => {
    const { intake, port, delivered } = await harness()
    const wrongPath = await new Promise<number>(resolve => {
      const request = httpRequest({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/companion/other',
        headers: { 'x-companion-token': currentToken() },
      }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      })
      request.end('{}')
    })
    expect(wrongPath).toBe(404)
    expect(delivered).toHaveLength(0)
    await intake.stop()
  })

  it('rejects malformed payloads with a reason', async () => {
    const { intake, port, delivered } = await harness()
    expect((await post(port, '{not json')).status).toBe(400)
    const noOrigin = await post(port, JSON.stringify({ ...payload(), origin: 'https://example.test/with/path' }))
    expect(noOrigin.status).toBe(400)
    expect(String(noOrigin.json.error)).toContain('origin')
    const badSeq = await post(port, JSON.stringify({ ...payload(), seq: 0 }))
    expect(badSeq.status).toBe(400)
    expect(delivered).toHaveLength(0)
    await intake.stop()
  })

  it('rejects an unexpected Host header (DNS rebinding)', async () => {
    const { intake, port, delivered } = await harness()
    const response = await post(port, JSON.stringify(payload()), { host: 'evil.test' })
    expect(response.status).toBe(403)
    expect(delivered).toHaveLength(0)
    await intake.stop()
  })

  it('frees the port when stopped', async () => {
    const { intake, port } = await harness()
    await intake.stop()
    await expect(post(port, JSON.stringify(payload()))).rejects.toThrow()
  })

  it('fails loudly when the port is taken', async () => {
    const first = await harness()
    const tokens = tokenStore()
    const second = new CompanionIntake({
      tokens,
      deliver: () => true,
      port: first.port,
    })
    await expect(second.start()).rejects.toThrow(/already in use/)
    await first.intake.stop()
  })
})

function editorPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: 'editor',
    app: { bundleId: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
    workspaceRoot: '/Users/someone/Projects/demo',
    filePath: '/Users/someone/Projects/demo/src/main.ts',
    languageId: 'typescript',
    surfaceKind: 'editor',
    title: 'main.ts',
    editorSession: 'editor-1',
    seq: 1,
    observedAtMs: 10_000,
    ...overrides,
  }
}

describe('editor payloads (ADR 0009)', () => {
  it('accepts an editor payload and reports it as stored', async () => {
    const { intake, port, delivered } = await harness()
    const response = await post(port, JSON.stringify(editorPayload()))
    expect(response.status).toBe(201)
    expect(response.json).toEqual({ stored: true })
    expect(delivered[0]).toMatchObject({
      source: 'editor',
      workspaceRoot: '/Users/someone/Projects/demo',
      filePath: '/Users/someone/Projects/demo/src/main.ts',
    })
    await intake.stop()
  })

  it('refuses a body it has no field for, rather than ignoring it', async () => {
    const { intake, port, delivered } = await harness()
    // The point of the boundary: document text cannot travel, because the shape
    // has nowhere to put it and unknown fields are refused.
    const response = await post(
      port,
      JSON.stringify(editorPayload({ text: 'secret document body' })),
    )
    expect(response.status).toBe(400)
    expect(response.json).toMatchObject({
      error: expect.stringContaining('unknown field for an editor payload: text'),
    })
    expect(delivered).toHaveLength(0)
    await intake.stop()
  })

  it('refuses fields that belong to the other shape', async () => {
    const { intake, port } = await harness()
    const browserFieldOnEditor = await post(
      port,
      JSON.stringify(editorPayload({ origin: 'https://example.test' })),
    )
    expect(browserFieldOnEditor.status).toBe(400)
    const editorFieldOnBrowser = await post(
      port,
      JSON.stringify({ ...payload(), workspaceRoot: '/tmp' }),
    )
    expect(editorFieldOnBrowser.status).toBe(400)
    await intake.stop()
  })

  it('refuses a file outside the root it claims', async () => {
    const { intake, port } = await harness()
    const response = await post(
      port,
      JSON.stringify(editorPayload({ filePath: '/Users/someone/elsewhere/main.ts' })),
    )
    expect(response.status).toBe(400)
    expect(response.json).toMatchObject({
      error: expect.stringContaining('must live under workspaceRoot'),
    })
    await intake.stop()
  })

  it('refuses a payload with no source kind', async () => {
    const { intake, port } = await harness()
    const { source: _source, ...withoutSource } = editorPayload()
    const response = await post(port, JSON.stringify(withoutSource))
    expect(response.status).toBe(400)
    expect(response.json).toMatchObject({
      error: expect.stringContaining('source must be'),
    })
    await intake.stop()
  })
})

describe('a declared identity (ADR 0011)', () => {
  it('accepts a claim and carries it through', async () => {
    const { intake, port, delivered } = await harness()
    const response = await post(port, JSON.stringify(editorPayload({
      app: { bundleId: 'com.todesktop.230313mzl4w4u92', name: 'Cursor' },
    })))
    expect(response.status).toBe(201)
    expect(delivered[0]).toMatchObject({
      source: 'editor',
      app: { bundleId: 'com.todesktop.230313mzl4w4u92', name: 'Cursor' },
    })
    await intake.stop()
  })

  it('refuses a claim that is not an identity', async () => {
    const { intake, port } = await harness()
    const claims = [
      { bundleId: '', name: 'Cursor' },
      { bundleId: 'com.example cursor', name: 'Cursor' },
      { bundleId: 'com.example.cursor', name: '   ' },
      { bundleId: 'com.example.cursor', name: 'Cursor', extra: 'x' },
      'com.example.cursor',
    ]
    const responses = await Promise.all(
      claims.map(app => post(port, JSON.stringify(editorPayload({ app })))),
    )
    for (const [index, response] of responses.entries()) {
      expect(response.status, JSON.stringify(claims[index])).toBe(400)
    }
    await intake.stop()
  })

  it('refuses an editor payload with no identity at all', async () => {
    const { intake, port } = await harness()
    const { app: _app, ...withoutApp } = editorPayload() as Record<string, unknown>
    const response = await post(port, JSON.stringify(withoutApp))
    expect(response.status).toBe(400)
    expect(response.json).toMatchObject({
      error: expect.stringContaining('app is required'),
    })
    await intake.stop()
  })
})

describe('whether a client is actually connected (ADR 0007)', () => {
  it('keeps browser and editor contact state separate', async () => {
    const { intake, port } = await harness()
    expect(intake.lastSeen()).toBeUndefined()
    expect(intake.lastSeen('browser')).toBeUndefined()
    expect(intake.lastSeen('editor')).toBeUndefined()

    await post(port, JSON.stringify(editorPayload()))
    expect(intake.lastSeen('editor')).toBeTypeOf('number')
    expect(intake.lastSeen('browser')).toBeUndefined()

    await post(port, JSON.stringify(payload()))
    expect(intake.lastSeen('browser')).toBeTypeOf('number')
    expect(intake.lastSeen()).toBeTypeOf('number')
    await intake.stop()
  })

  it('refuses a credential for the wrong companion kind', async () => {
    const { intake, port, delivered } = await harness()
    const response = await post(port, JSON.stringify(editorPayload()), {
      'x-companion-token': currentToken('browser'),
    })
    expect(response.status).toBe(401)
    expect(delivered).toHaveLength(0)
    expect(intake.lastSeen('editor')).toBeUndefined()
    await intake.stop()
  })

  it('does not record a request that failed the token check', async () => {
    const { intake, port } = await harness()
    await fetch(`http://127.0.0.1:${port}/companion/observation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-companion-token': 'wrong' },
      body: JSON.stringify(editorPayload()),
    }).catch(() => undefined)
    expect(intake.lastSeen()).toBeUndefined()
    await intake.stop()
  })
})

// A third editor is the point of a wire format: the intake must not care which editor sent the report,
// only that the report satisfies the shape. This is what P7's JetBrains client has to clear, and it can be
// measured here without a JVM - which is the honest half of that work, and the half a document cannot do.
const jetbrainsReport = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    source: 'editor',
    app: { bundleId: 'com.jetbrains.pycharm', name: 'PyCharm' },
    workspaceRoot: '/Users/you/Projects/demo',
    filePath: '/Users/you/Projects/demo/src/main.py',
    languageId: 'python',
    surfaceKind: 'editor',
    title: 'main.py',
    editorSession: 'pycharm-run-1',
    seq: 1,
    observedAtMs: 1_790_000_000_000,
  ...extra,
})

const postReport = async (port: number, token: string, body: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}/companion/observation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-companion-token': token },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('a third editor, speaking the documented wire format', () => {
  it('accepts a JetBrains report that satisfies the shape', async () => {
    const { port, delivered } = await harness()
    const result = await postReport(port, currentToken('editor'), jetbrainsReport())
    expect(result.status).toBe(201)
    expect(result.body.stored).toBe(true)
    // Delivery is the assertion here; how a workspace is carried and honoured is
    // tests/integration/companion-workspace.spec.ts's subject, and restating its expectation here would be
    // a second place to keep in step.
    expect(delivered).toHaveLength(1)
  })

  it('refuses a field the shape does not have, rather than ignoring it', async () => {
    // The boundary that makes "there is no field for text" enforceable: an editor that adds one gets an
    // error, not a silent success. This is also where the collector parser differs, which is recorded as an
    // open contract decision in docs/collector-protocol.md.
    const { port, delivered } = await harness()
    const result = await postReport(port, currentToken('editor'), jetbrainsReport({ selectionText: 'secret' }))
    expect(result.status).toBe(400)
    expect(delivered).toHaveLength(0)
  })

  it('refuses a report with no token at all', async () => {
    const { port, delivered } = await harness()
    const response = await fetch(`http://127.0.0.1:${port}/companion/observation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(jetbrainsReport()),
    })
    expect(response.status).toBe(401)
    expect(delivered).toHaveLength(0)
  })
})
