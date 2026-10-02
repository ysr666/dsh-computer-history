import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MinimisedSummaryPayload, ObservationId } from '../../src/shared/index.js'
import { SemanticOptInStore } from '../../src/host/semantic/opt-in.js'
import {
  RemoteSummaryProvider,
  type RemoteSendRecord,
} from '../../src/host/semantic/remote-provider.js'
import { SummaryProviderError } from '../../src/host/semantic/provider.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function optIns(): SemanticOptInStore {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-remote-'))
  roots.push(root)
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  return new SemanticOptInStore(history.db)
}

const payload: MinimisedSummaryPayload = {
  appBundleIds: ['com.microsoft.VSCode'],
  surfaceKinds: ['editor'],
  resourceKinds: ['file'],
  fileExtensions: ['ts'],
  observationCount: 3,
  startHourOfDay: 14,
  durationMinutes: 25,
  workspaceRootName: 'demo',
  hasThread: true,
}

const scope = { kind: 'workspace' as const, id: 'w1' }

/** A fetch that records every call, so "no network call" is provable. */
function recordingFetch(response: unknown, ok = true) {
  const calls: Array<{ url: string, body: string }> = []
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => response,
    } as unknown as Response
  }) as unknown as typeof fetch
  return { calls, impl }
}

function provider(input: {
  store: SemanticOptInStore
  fetchImpl: typeof fetch
  sent?: RemoteSendRecord[]
  endpoint?: string
}) {
  return new RemoteSummaryProvider({
    endpoint: input.endpoint ?? 'https://models.example.test/v1/summarise',
    model: 'test-model',
    optIns: input.store,
    fetchImpl: input.fetchImpl,
    now: () => 5_000,
    ...(input.sent ? { onSent: (record: RemoteSendRecord) => { input.sent!.push(record) } } : {}),
  })
}

describe('remote summary provider (ADR 0010)', () => {
  it('makes no network call at all without a recorded opt-in', async () => {
    const store = optIns()
    const { calls, impl } = recordingFetch({ summary: 'x', citations: [1 as ObservationId] })
    const subject = provider({ store, fetchImpl: impl })

    await expect(subject.summarise({
      scope,
      payload,
      citations: [1 as ObservationId],
    })).rejects.toThrow(SummaryProviderError)

    // The point of checking the gate first: nothing was even attempted.
    expect(calls).toEqual([])
  })

  it('sends the minimised payload and nothing else, once', async () => {
    const store = optIns()
    store.grant(scope, 'remote', 'test-model', 1)
    const { calls, impl } = recordingFetch({ summary: 'Worked on a file.', citations: [1 as ObservationId, 2 as ObservationId] })
    const sent: RemoteSendRecord[] = []
    const subject = provider({ store, fetchImpl: impl, sent })

    const summary = await subject.summarise({
      scope,
      payload,
      citations: [1 as ObservationId, 2 as ObservationId],
    })

    expect(summary).toBe('Worked on a file.')
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0]!.body) as Record<string, unknown>
    expect(Object.keys(body).toSorted()).toEqual(['model', 'observationIds', 'payload'])
    expect(body.payload).toEqual(payload)
    // Nothing that could name a path, a page or a document.
    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain('/Users/')
    expect(serialised).not.toContain('http')
    expect(serialised).not.toContain('main.ts')
    // What left is recorded for the audit.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      endpointHost: 'models.example.test',
      model: 'test-model',
      sentAtMs: 5_000,
    })
    expect(sent[0]!.payloadDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a citation it was not given', async () => {
    const store = optIns()
    store.grant(scope, 'remote', 'test-model', 1)
    const { impl } = recordingFetch({ summary: 'text', citations: [99 as ObservationId] })
    const subject = provider({ store, fetchImpl: impl })

    await expect(subject.summarise({
      scope,
      payload,
      citations: [1 as ObservationId],
    })).rejects.toThrow(/cited an observation it was not given/)
  })

  it('refuses a summary with no citations, a non-https endpoint and an error response', async () => {
    const store = optIns()
    store.grant(scope, 'remote', 'test-model', 1)

    const noCitations = recordingFetch({ summary: 'text', citations: [] })
    await expect(provider({ store, fetchImpl: noCitations.impl }).summarise({
      scope, payload, citations: [1 as ObservationId],
    })).rejects.toThrow(/must cite the observations/)

    const plaintext = recordingFetch({ summary: 'text', citations: [1 as ObservationId] })
    await expect(provider({
      store,
      fetchImpl: plaintext.impl,
      endpoint: 'http://models.example.test/v1',
    }).summarise({ scope, payload, citations: [1 as ObservationId] }))
      .rejects.toThrow(/must use https/)
    expect(plaintext.calls).toEqual([])

    const failing = recordingFetch({ summary: 'text', citations: [1 as ObservationId] }, false)
    await expect(provider({ store, fetchImpl: failing.impl }).summarise({
      scope, payload, citations: [1 as ObservationId],
    })).rejects.toThrow(/answered 500/)
    // No retry: one attempt, and one attempt only.
    expect(failing.calls).toHaveLength(1)
  })

  it('does not send for a scope that opted into local only', async () => {
    const store = optIns()
    store.grant(scope, 'local', 'llama', 1)
    const { calls, impl } = recordingFetch({ summary: 'x', citations: [1 as ObservationId] })
    await expect(provider({ store, fetchImpl: impl }).summarise({
      scope, payload, citations: [1 as ObservationId],
    })).rejects.toThrow(SummaryProviderError)
    expect(calls).toEqual([])
  })
})
