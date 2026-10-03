import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CollectorSessionId,
  EpisodeId,
  PolicyRuleId,
  type ActivityObservation,
  type ComputerHistoryServiceContract,
} from '../../src/shared/index.js'
import {
  ComputerHistoryService,
  LocalComputerHistoryBackend,
  type CaptureController,
} from '../../src/host/service/index.js'
import { DeletionService } from '../../src/host/retention/index.js'
import {
  EpisodeStore,
  ObservationStore,
  openHistoryDatabase,
  PolicyStore,
  ResourceStore,
} from '../../src/host/store/index.js'

const roots: string[] = []

function openTempDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-service-'))
  roots.push(root)
  return openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function seedEpisode(history: ReturnType<typeof openTempDatabase>): EpisodeId {
  const resources = new ResourceStore(history.db)
  const observations = new ObservationStore(history.db)
  const episodes = new EpisodeStore(history.db)

  const value: ActivityObservation = {
    collectorSessionId: CollectorSessionId('collector-service'),
    seq: 1,
    observedAtMs: 1_000,
    app: {
      pid: 101,
      bundleId: 'com.microsoft.VSCode',
    },
    surface: {
      kind: 'editor',
    },
    resource: {
      kind: 'file',
      canonicalUri: 'file:///alpha/src/provider.ts',
      displayLabel: 'provider.ts',
    },
    workspace: {
      id: 'alpha',
      root: '/alpha',
      title: 'alpha',
      source: 'dsh',
      confidence: 1,
    },
    activity: {},
    privacy: {
      secure: false,
      protected: false,
    },
    source: {
      provider: 'macos-ax',
      adapter: 'vscode',
    },
    policyRevision: 1,
    expiresAtMs: 100_000,
  }

  const resourceId = resources.upsert(value.resource!, value.observedAtMs)
  const observationId = observations.insert(value, resourceId)
  const id = EpisodeId('episode:collector-service:1')

  episodes.replace({
    id,
    startedAtMs: 1_000,
    endedAtMs: 1_000,
    startReason: 'first-observation',
    endReason: 'timeout',
    workspace: {
      id: 'alpha',
      root: '/alpha',
      title: 'alpha',
    },
    threadKey: 'workspace:alpha',
    lastStrongResourceId: resourceId,
    summaryKind: 'deterministic',
    summary: 'Worked in alpha.',
    confidence: 1,
    state: 'closed',
    createdAtMs: 2_000,
    updatedAtMs: 2_000,
    expiresAtMs: 100_000,
    observationIds: [observationId],
          })

  return id
}

class FakeCapture implements CaptureController {
  public paused = false

  public async pause(): Promise<void> {
    this.paused = true
  }

  public async resume(): Promise<void> {
    this.paused = false
  }

  public getState() {
    return {
      enabled: true,
      capture: this.paused ? 'paused' as const : 'running' as const,
      accessibilityTrusted: true,
      collector: {
        version: '0.1.0',
        arch: 'arm64',
      },
    }
  }
}

describe('local computer history backend', () => {
  it('composes store, resume, policy, capture, and deletion behavior', async () => {
    const history = openTempDatabase()
    const episodeId = seedEpisode(history)
    const episodes = new EpisodeStore(history.db)
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(100)
    const capture = new FakeCapture()

    const backend = new LocalComputerHistoryBackend(
      episodes,
      policies,
      new DeletionService(history.db),
      capture,
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        now: () => 10_000,
      },
    )

    expect(await backend.recent()).toHaveLength(1)
    expect(
      (await backend.search({ query: 'provider.ts' }))[0]?.id,
    ).toBe(episodeId)

    const resolved = await backend.resolveResume({
      query: '继续 alpha',
      nowMs: 10_000,
      turn: 1,
      source: 'automatic',
    })
    expect(resolved.status).toBe('hit')

    await backend.pause()
    expect(backend.getState().capture).toBe('paused')
    await backend.resume()
    expect(backend.getState()).toMatchObject({
      capture: 'running',
      observationRetentionHours: 24,
      episodeRetentionDays: 30,
      autoResume: false,
    })

    await expect(backend.replacePolicy({
      mode: 'exclude',
      rules: [],
    })).rejects.toThrow(/include-only/)

    const policy = await backend.replacePolicy({
      mode: 'include-only',
      rules: [{
        id: PolicyRuleId('rule-1'),
        dimension: 'app',
        action: 'deny',
        matcher: 'exact',
        pattern: 'com.example.Private',
        builtIn: false,
        createdAtMs: 100,
        updatedAtMs: 100,
      }],
    })
    expect(policy.revision).toBe(2)
    expect(backend.listPolicyRules().some(rule => rule.id === PolicyRuleId('rule-1'))).toBe(true)

    const builtIn = backend.listPolicyRules().find(rule => rule.builtIn)!
    await expect(backend.replacePolicy({
      mode: 'include-only',
      rules: [{
        ...builtIn,
        pattern: 'com.example.Tampered',
      }],
    })).rejects.toThrow(/invalid built-in rule/)
    await expect(backend.replacePolicy({
      mode: 'include-only',
      rules: [{
        ...builtIn,
        builtIn: false,
      }],
    })).rejects.toThrow(/reserved/)
    const duplicate = {
      id: PolicyRuleId('duplicate'),
      dimension: 'app' as const,
      action: 'deny' as const,
      matcher: 'exact' as const,
      pattern: 'com.example.Private',
      builtIn: false,
      createdAtMs: 100,
      updatedAtMs: 100,
    }
    await expect(backend.replacePolicy({
      mode: 'include-only',
      rules: [duplicate, duplicate],
    })).rejects.toThrow(/duplicate rule id/)
    expect(backend.getPolicy().revision).toBe(2)

    expect(await backend.delete({
      scope: {
        kind: 'episode',
        episodeId,
      },
    })).toEqual({
      observationsDeleted: 1,
      episodesDeleted: 1,
      episodesRebuilt: 0,
    })
    expect(await backend.recent()).toEqual([])

    history.close()
  })
})

describe('Cordis computer history service', () => {
  it('provides the stable ctx.computerHistory capability', async () => {
    const state = {
      enabled: true,
      capture: 'running' as const,
      accessibilityTrusted: true,
      observationRetentionHours: 24,
      episodeRetentionDays: 30,
      autoResume: false,
    }

    const backend: ComputerHistoryServiceContract = {
      async recent() { return [] },
      async search() { return [] },
      async getEpisode() { return undefined },
      async resolveResume() {
        return { status: 'none', reason: 'fixture' }
      },
      async delete() {
        return {
          observationsDeleted: 0,
          episodesDeleted: 0,
          episodesRebuilt: 0,
        }
      },
      async pause() {},
      async resume() {},
      getState() { return state },
      async threads() { return [] },
      async thread() { return undefined },
      async timeline() { return [] },
      retention() {
        return { observationRetentionHours: 24, episodeRetentionDays: 30, updatedAtMs: 0 }
      },
      setRetention() {
        return { observationRetentionHours: 24, episodeRetentionDays: 30, updatedAtMs: 1 }
      },
      redactionPreview() {
        return {
          scopeKey: 'app:x',
          policyRevision: 1,
          rulesInForce: { protectedBundleIds: [], protectedPatterns: [], hasProtectRule: false },
          checked: 0,
          excluded: [],
        }
      },
      exportAll() {
        return { schema: 'dsh-computer-history/v1', exportedAtMs: 1, schemaVersion: 1, tables: {} }
      },
      importAll() { return { imported: {} } },
      semanticState() {
        return { active: 'deterministic', localProviderConfigured: false, scopes: [] }
      },
      semanticPreview() { return undefined },
      grantSemanticOptIn(request) {
        return { scopeKey: request.scopeKey, providerKind: request.providerKind, createdAtMs: 1 }
      },
      revokeSemanticOptIn() { return { revoked: false, purged: 0, forgotten: 0 } },
      pairing() { return { paired: false, listening: false } },
      rotatePairing() {
        return { paired: true, listening: false, token: 'stub-token' }
      },
      listPolicyRules() { return [] },
      getPolicy() { return { revision: 1, mode: 'include-only', rules: [], updatedAtMs: 1 } },
      async replacePolicy() {
        return {
          revision: 1,
          mode: 'include-only',
          rules: [],
          updatedAtMs: 1,
        }
      },
    }

    const ctx = new Context()
    const fiber = await ctx.plugin(
      ComputerHistoryService,
      { backend },
    )

    expect(ctx.computerHistory.getState()).toEqual(state)
    expect(await ctx.computerHistory.recent()).toEqual([])

    await fiber.dispose()
    expect(ctx.get('computerHistory', false)).toBeUndefined()
  })
})
