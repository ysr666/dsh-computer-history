import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MinimisedSummaryPayload, ObservationId } from '../../src/shared/index.js'
import { SemanticOptInStore } from '../../src/host/semantic/opt-in.js'
import {
  buildRemoteRequestBody,
  RemoteSummaryProvider,
} from '../../src/host/semantic/remote-provider.js'
import { RemoteSendStore } from '../../src/host/semantic/send-store.js'
import { SummaryProviderError } from '../../src/host/semantic/provider.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const payload: MinimisedSummaryPayload = {
  appBundleIds: ['com.microsoft.VSCode'],
  surfaceKinds: ['editor'],
  resourceKinds: ['file'],
  fileExtensions: ['ts'],
  observationCount: 2,
  startHourOfDay: 9,
  durationMinutes: 12,
  workspaceRootName: 'demo',
  hasThread: true,
}

const citations = [1 as ObservationId, 2 as ObservationId]
const scope = { kind: 'workspace' as const, id: 'w1' }
const scopeKey = 'workspace:w1'
const endpoint = 'https://models.example.test/v1/summarise'
const model = 'remote-model'

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-flow-'))
  roots.push(root)
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  const now = 10_000
  history.db.prepare(`INSERT INTO episodes(id, started_at_ms, ended_at_ms,
    start_reason, end_reason, summary_kind, summary_text, confidence, state,
    created_at_ms, updated_at_ms) VALUES ('ep-1', 1, 2, 'first-observation',
    'timeout', 'deterministic', 'text', 0.5, 'closed', 1, 1)`).run()
  return {
    history,
    optIns: new SemanticOptInStore(history.db),
    sends: new RemoteSendStore(history.db),
    now,
  }
}

/** A fetch that keeps the exact bytes it was handed. */
function capturingFetch(response: unknown) {
  const bodies: string[] = []
  const impl = (async (_url: string | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''))
    return { ok: true, status: 200, json: async () => response } as unknown as Response
  }) as unknown as typeof fetch
  return { bodies, impl }
}

describe('remote summary flow (ADR 0010)', () => {
  it('sends exactly the bytes the preview showed, and records what left', async () => {
    const { history, optIns, sends, now } = setup()
    optIns.grant(scope, 'remote', model, 1)

    // What the panel would show before the user switches the scope on.
    const previewBody = buildRemoteRequestBody({
      model,
      payload,
      observationIds: citations,
    })

    const { bodies, impl } = capturingFetch({ summary: 'Worked on a file.', citations: [1, 2] })
    const provider = new RemoteSummaryProvider({
      endpoint,
      model,
      optIns,
      fetchImpl: impl,
      now: () => now,
      onSent: record => {
        sends.record({ ...record, scopeKey, episodeId: 'ep-1' })
      },
    })

    const summary = await provider.summarise({ scope, payload, citations })

    expect(summary).toBe('Worked on a file.')
    // The promise the ADR makes: what was previewed is what was sent, byte for byte.
    expect(bodies).toEqual([previewBody])
    const digest = createHash('sha256').update(previewBody).digest('hex')
    expect(sends.listForScope(scopeKey)).toEqual([{
      id: 1,
      episodeId: 'ep-1',
      scopeKey,
      endpointHost: 'models.example.test',
      model,
      payloadDigest: digest,
      sentAtMs: now,
    }])
    history.close()
  })

  it('sends nothing and records nothing without an opt-in', async () => {
    const { history, optIns, sends } = setup()
    const { bodies, impl } = capturingFetch({ summary: 'x', citations: [1] })
    const provider = new RemoteSummaryProvider({
      endpoint,
      model,
      optIns,
      fetchImpl: impl,
      onSent: record => { sends.record({ ...record, scopeKey }) },
    })

    await expect(provider.summarise({ scope, payload, citations }))
      .rejects.toThrow(SummaryProviderError)
    expect(bodies).toEqual([])
    expect(sends.listForScope(scopeKey)).toEqual([])
    history.close()
  })
})
