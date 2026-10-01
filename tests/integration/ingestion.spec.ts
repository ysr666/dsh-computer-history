import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PolicyRuleId,
  type NativeObservation,
} from '../../src/shared/index.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import {
  EpisodeStore,
  ObservationStore,
  openHistoryDatabase,
  PolicyStore,
} from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function native(bundleId = 'com.microsoft.VSCode'): NativeObservation {
  return {
    v: 1,
    type: 'observation',
    collectorSession: 'live-1',
    seq: 1,
    observedAtMs: 1_000,
    app: { pid: 1, bundleId },
    window: {
      title: 'provider.ts',
      document: '/alpha/src/provider.ts',
    },
    privacy: { secure: false, protected: false },
    source: { adapter: 'vscode' },
  }
}

describe('live ingestion', () => {
  it('persists allowed metadata and derives a workspace episode', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-live-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    policies.replace('include-only', [{
      id: PolicyRuleId('allow-code'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.microsoft.VSCode',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)

    const ingestion = new IngestionService(
      history.db,
      {
        resolve: async () => ({
          id: 'alpha',
          root: '/alpha',
          title: 'alpha',
          source: 'dsh',
          confidence: 1,
        }),
      },
      () => policies.get(),
      () => 2_000,
    )

    expect(await ingestion.ingest(native())).toBe(true)
    expect(new ObservationStore(history.db).count()).toBe(1)
    const episodes = new EpisodeStore(history.db).listRecent()
    expect(episodes).toHaveLength(1)
    expect(episodes[0]).toMatchObject({
      workspace: { id: 'alpha' },
      summaryKind: 'deterministic',
    })
    history.close()
  })

  it('fails closed for unlisted and browser observations', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-live-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const ingestion = new IngestionService(
      history.db,
      { resolve: async () => ({ source: 'none', confidence: 0 }) },
      () => policies.get(),
      () => 2_000,
    )
    expect(await ingestion.ingest(native('com.apple.Notes'))).toBe(false)

    policies.replace('include-only', [{
      id: PolicyRuleId('allow-chrome'),
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: 'com.google.Chrome',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    }], 2)
    expect(await ingestion.ingest(native('com.google.Chrome'))).toBe(false)
    expect(new ObservationStore(history.db).count()).toBe(0)
    history.close()
  })
})
