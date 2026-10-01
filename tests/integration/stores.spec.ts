import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CollectorSessionId,
  PolicyRuleId,
  type ActivityObservation,
} from '../../src/shared/index.js'
import {
  ObservationStore,
  openHistoryDatabase,
  PolicyStore,
  ResourceStore,
} from '../../src/host/store/index.js'

const roots: string[] = []

function openTempDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-store-'))
  roots.push(root)
  return openHistoryDatabase({ dataDirectory: path.join(root, 'history'), nowMs: 1 })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function observation(
  overrides: Partial<ActivityObservation> = {},
): ActivityObservation {
  return {
    collectorSessionId: CollectorSessionId('collector-1'),
    seq: 1,
    observedAtMs: 10_000,
    app: {
      pid: 123,
      bundleId: 'com.microsoft.VSCode',
      displayName: 'Code',
    },
    surface: { kind: 'editor', title: 'provider.ts' },
    resource: {
      kind: 'file',
      canonicalUri: 'file:///repo/src/provider.ts',
      displayLabel: 'provider.ts',
    },
    workspace: {
      id: 'workspace-1',
      root: '/repo',
      title: 'repo',
      source: 'dsh',
      confidence: 1,
    },
    activity: { idleSeconds: 0.2 },
    privacy: { secure: false, protected: false },
    source: { provider: 'macos-ax', adapter: 'vscode' },
    policyRevision: 1,
    expiresAtMs: 20_000,
    ...overrides,
  }
}

describe('resource and observation stores', () => {
  it('upserts resource identity and preserves first-seen time', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const first = resources.upsert(
      {
        kind: 'file',
        canonicalUri: 'file:///repo/src/provider.ts',
        displayLabel: 'provider.ts',
      },
      100,
    )
    const second = resources.upsert(
      {
        kind: 'file',
        canonicalUri: 'file:///repo/src/provider.ts',
        displayLabel: 'provider.ts',
      },
      200,
    )
    expect(second).toBe(first)
    expect(resources.getById(first)).toMatchObject({
      firstSeenAtMs: 100,
      lastSeenAtMs: 200,
    })
    history.close()
  })

  it('deduplicates collector session and sequence at the database boundary', () => {
    const history = openTempDatabase()
    const resources = new ResourceStore(history.db)
    const observations = new ObservationStore(history.db)
    const value = observation()
    const resourceId = resources.upsert(value.resource!, value.observedAtMs)
    const first = observations.insert(value, resourceId)
    const second = observations.insert(value, resourceId)
    expect(second).toBe(first)
    expect(observations.count()).toBe(1)
    history.close()
  })

  it('deletes only expired observations', () => {
    const history = openTempDatabase()
    const observations = new ObservationStore(history.db)
    observations.insert(observation())
    observations.insert(observation({ seq: 2, expiresAtMs: 40_000 }))
    expect(observations.deleteExpired(25_000)).toBe(1)
    expect(observations.count()).toBe(1)
    history.close()
  })
})

describe('policy store', () => {
  it('initializes include-only capture and revisions policy replacement', () => {
    const history = openTempDatabase()
    const policies = new PolicyStore(history.db)
    expect(policies.ensureInitial(100)).toMatchObject({
      revision: 1,
      mode: 'include-only',
      updatedAtMs: 100,
    })

    const updated = policies.replace(
      'exclude',
      [{
        id: PolicyRuleId('rule-1'),
        dimension: 'app',
        action: 'deny',
        matcher: 'exact',
        pattern: 'com.example.Private',
        builtIn: false,
        createdAtMs: 100,
        updatedAtMs: 100,
      }],
      200,
    )

    expect(updated.revision).toBe(2)
    expect(updated.mode).toBe('exclude')
    expect(updated.rules.some(rule => rule.builtIn)).toBe(true)
    expect(updated.rules.find(rule => rule.id === PolicyRuleId('rule-1'))?.updatedAtMs).toBe(200)
    history.close()
  })
})
