import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EpisodeId,
  type EpisodeDetail,
  type ObservationId,
} from '../../src/shared/index.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'
import { minimiseEpisode } from '../../src/host/semantic/minimise.js'
import {
  assertLoopbackEndpoint,
  SummaryProviderError,
} from '../../src/host/semantic/provider.js'
import {
  LocalSummaryProvider,
  buildPrompt,
} from '../../src/host/semantic/local-provider.js'
import {
  assertRemoteOptIn,
  providerKindAllowed,
  SemanticOptInStore,
} from '../../src/host/semantic/opt-in.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function episode(): EpisodeDetail {
  return {
    id: EpisodeId('episode-1'),
    startedAtMs: new Date('2026-10-02T09:15:00').getTime(),
    endedAtMs: new Date('2026-10-02T10:45:00').getTime(),
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    workspace: {
      id: 'workspace-1',
      root: '/Users/someone/Projects/secret-client',
      title: 'secret-client',
    },
    threadKey: 'workspace:workspace-1',
    summaryKind: 'deterministic',
    summary: 'Worked in secret-client on billing.ts',
    summaryObservationIds: [1, 2] as ObservationId[],
    observationIds: [1, 2] as ObservationId[],
    resources: [
      {
        kind: 'file',
        canonicalUri: 'file:///Users/someone/Projects/secret-client/src/billing.ts?token=1#l2',
        displayLabel: 'billing.ts',
        firstSeenAtMs: 1,
        lastSeenAtMs: 2,
        observationCount: 2,
      },
      {
        kind: 'url',
        canonicalUri: 'https://internal.example.com/private/invoice?id=7',
        displayLabel: 'Invoice',
        firstSeenAtMs: 1,
        lastSeenAtMs: 2,
        observationCount: 1,
      },
    ],
    surfaces: [
      { bundleId: 'com.microsoft.VSCode', surfaceKind: 'editor', firstSeenAtMs: 1, lastSeenAtMs: 2, observationCount: 2 },
      { bundleId: 'com.google.Chrome', surfaceKind: 'browser', firstSeenAtMs: 1, lastSeenAtMs: 2, observationCount: 1 },
    ],
    confidence: 0.8,
    state: 'closed',
  }
}

describe('summary payload minimisation (ADR 0004 §4)', () => {
  it('carries shape only, never a path, a title or an address', () => {
    const payload = minimiseEpisode(episode())
    const serialised = JSON.stringify(payload)

    for (const secret of [
      '/Users/',
      '/Projects/',
      'billing.ts',
      'https://internal.example.com',
      'invoice',
      'token=1',
      'Worked in',
    ]) {
      expect(serialised, secret).not.toContain(secret)
    }
    // ADR 0004 §4 allows the workspace root **basename**: it names the work
    // without saying where on disk it lives. The full path must not survive.
    expect(payload.workspaceRootName).toBe('secret-client')
    expect(serialised).not.toContain('/Projects/')
    expect(payload).toMatchObject({
      appBundleIds: ['com.google.Chrome', 'com.microsoft.VSCode'],
      surfaceKinds: ['browser', 'editor'],
      resourceKinds: ['file', 'url'],
      fileExtensions: ['ts'],
      observationCount: 2,
      hasThread: true,
    })
    expect(payload.durationMinutes).toBe(90)
    expect(payload.startHourOfDay).toBe(9)
  })
})

describe('loopback-only providers (ADR 0004 §3)', () => {
  it('refuses any endpoint that is not on this machine', () => {
    for (const endpoint of [
      'http://example.com',
      'https://api.openai.com',
      'http://192.168.1.10:11434',
      'http://[2001:db8::1]:11434',
    ]) {
      expect(() => assertLoopbackEndpoint(endpoint), endpoint)
        .toThrow(SummaryProviderError)
      expect(() => new LocalSummaryProvider({ endpoint, model: 'm' }), endpoint)
        .toThrow(/loopback/)
    }
    for (const endpoint of [
      'http://127.0.0.1:11434',
      'http://localhost:11434',
      'http://[::1]:11434',
    ]) {
      expect(() => assertLoopbackEndpoint(endpoint), endpoint).not.toThrow()
    }
  })

  it('sends the minimised payload and nothing else', async () => {
    const bodies: string[] = []
    const provider = new LocalSummaryProvider({
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body))
        return new Response(JSON.stringify({ response: 'Worked on code.' }))
      }) as unknown as typeof fetch,
    })
    const payload = minimiseEpisode(episode())
    const summary = await provider.summarise({
      scope: { kind: 'workspace', id: 'workspace-1' },
      payload,
      citations: [1, 2] as ObservationId[],
    })

    expect(summary).toBe('Worked on code.')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toContain('/Users/')
    expect(bodies[0]).not.toContain('billing.ts')
    expect(bodies[0]).not.toContain('internal.example.com')
    // The payload travels inside the prompt JSON, so compare after parsing it
    // back out rather than against escaped text.
    const sent = JSON.parse(bodies[0] as string) as { prompt: string, model: string }
    expect(sent.model).toBe('llama3')
    expect(sent.prompt).toContain('"observationCount":2')
    expect(sent.prompt).not.toContain('/Users/')
    expect(buildPrompt({
      scope: { kind: 'workspace', id: 'w' },
      payload,
      citations: [],
    })).toContain('do not invent them')
  })

  it('fails loudly when the local model misbehaves', async () => {
    const failing = new LocalSummaryProvider({
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3',
      fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    })
    await expect(failing.summarise({
      scope: { kind: 'app', bundleId: 'com.example' },
      payload: minimiseEpisode(episode()),
      citations: [],
    })).rejects.toThrow(/answered 500/)

    const empty = new LocalSummaryProvider({
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3',
      fetchImpl: (async () => new Response(JSON.stringify({}))) as unknown as typeof fetch,
    })
    await expect(empty.summarise({
      scope: { kind: 'app', bundleId: 'com.example' },
      payload: minimiseEpisode(episode()),
      citations: [],
    })).rejects.toThrow(/no summary/)
  })
})

describe('per-scope opt-in (ADR 0004 §4)', () => {
  function store(): SemanticOptInStore {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-optin-'))
    roots.push(root)
    return new SemanticOptInStore(
      openHistoryDatabase({ dataDirectory: path.join(root, 'history'), nowMs: 1 }).db,
    )
  }

  it('is absent until granted, and remote stays impossible without it', () => {
    const optIns = store()
    const scope = { kind: 'workspace', id: 'workspace-1' } as const

    expect(optIns.get(scope)).toBeUndefined()
    expect(() => assertRemoteOptIn(optIns, scope)).toThrow(/off by default/)
    expect(providerKindAllowed(optIns, scope, 'remote')).toBe(false)
    // A local provider needs no consent to keep data on the machine.
    expect(providerKindAllowed(optIns, scope, 'local')).toBe(true)
    expect(providerKindAllowed(optIns, scope, 'deterministic')).toBe(true)

    optIns.grant(scope, 'remote', 'remote-model', 1_000)
    expect(optIns.get(scope)).toMatchObject({
      providerKind: 'remote',
      model: 'remote-model',
      createdAtMs: 1_000,
    })
    expect(() => assertRemoteOptIn(optIns, scope)).not.toThrow()
    expect(providerKindAllowed(optIns, scope, 'remote')).toBe(true)
  })

  it('scopes are independent and revoking removes the permission', () => {
    const optIns = store()
    const workspace = { kind: 'workspace', id: 'workspace-1' } as const
    const app = { kind: 'app', bundleId: 'com.example' } as const

    optIns.grant(workspace, 'remote', 'm', 1)
    expect(() => assertRemoteOptIn(optIns, app)).toThrow()
    expect(optIns.revoke(app)).toBe(false)
    expect(optIns.revoke(workspace)).toBe(true)
    expect(() => assertRemoteOptIn(optIns, workspace)).toThrow()
    expect(optIns.list()).toHaveLength(0)
  })
})
