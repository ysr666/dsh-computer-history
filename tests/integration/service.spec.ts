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
import { SemanticOptInStore } from '../../src/host/semantic/opt-in.js'
import { CompanionTokenStore } from '../../src/host/companion/token-store.js'
import { RemoteSendStore } from '../../src/host/semantic/send-store.js'

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

  public async recover(): Promise<void> {}

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
  it('rejects malformed semantic scopes instead of aliasing them to app scopes', () => {
    const history = openTempDatabase()
    seedEpisode(history)
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const backend = new LocalComputerHistoryBackend(
      new EpisodeStore(history.db),
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
      },
      undefined,
      new SemanticOptInStore(history.db),
      history.db,
    )

    expect(
      backend.semanticPreview({
        scopeKey: 'app:com.microsoft.VSCode',
      }),
    ).toBeDefined()
    expect(() => backend.semanticPreview({
      scopeKey: 'not-a-scope:com.microsoft.VSCode',
    })).toThrow(/unrecognised scope key/)
    expect(() => backend.semanticPreview({
      scopeKey: 'workspace:',
    })).toThrow(/unrecognised scope key/)
    expect(() => backend.redactionPreview({
      scopeKey: 'not-a-scope:com.microsoft.VSCode',
    })).toThrow(/unrecognised scope key/)
    history.close()
  })

  it('refreshes /state when another Host changes shared retention', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-service-multi-retention-'))
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const first = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const second = openHistoryDatabase({ dataDirectory, nowMs: 1 })
    const firstPolicies = new PolicyStore(first.db)
    firstPolicies.ensureInitial(1)
    const secondPolicies = new PolicyStore(second.db)

    const hostA = new LocalComputerHistoryBackend(
      new EpisodeStore(first.db),
      firstPolicies,
      new DeletionService(first.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
      },
      undefined,
      undefined,
      first.db,
    )
    const hostB = new LocalComputerHistoryBackend(
      new EpisodeStore(second.db),
      secondPolicies,
      new DeletionService(second.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        now: () => 4_000,
      },
      undefined,
      undefined,
      second.db,
    )

    expect(hostA.getState()).toMatchObject({
      observationRetentionHours: 24,
      episodeRetentionDays: 30,
    })
    hostB.setRetention({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
    })
    expect(hostA.getState()).toMatchObject({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
    })

    first.close()
    second.close()
  })

  it('finds semantic scope history even after more than 50 unrelated Episodes', () => {
    const history = openTempDatabase()
    seedEpisode(history)
    const episodes = new EpisodeStore(history.db)
    for (let index = 0; index < 60; index += 1) {
      episodes.replace({
        id: EpisodeId(`decoy-${index}`),
        startedAtMs: 10_000 + index,
        endedAtMs: 10_000 + index,
        startReason: 'first-observation',
        endReason: 'timeout',
        workspace: {
          id: `decoy-workspace-${index}`,
          root: `/decoy/${index}`,
          title: `decoy-${index}`,
        },
        summaryKind: 'deterministic',
        summary: `Decoy ${index}`,
        confidence: 1,
        state: 'closed',
        createdAtMs: 10_000 + index,
        updatedAtMs: 10_000 + index,
        observationIds: [],
      })
    }

    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const backend = new LocalComputerHistoryBackend(
      episodes,
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
      },
      undefined,
      new SemanticOptInStore(history.db),
      history.db,
    )

    expect(backend.semanticPreview({
      scopeKey: 'workspace:alpha',
    })).toBeDefined()
    expect(backend.semanticPreview({
      scopeKey: 'app:com.microsoft.VSCode',
    })).toBeDefined()
    history.close()
  })

  it('keeps /state retention in step with a successful retention change', () => {
    const history = openTempDatabase()
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const backend = new LocalComputerHistoryBackend(
      new EpisodeStore(history.db),
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        now: () => 9_000,
      },
      undefined,
      undefined,
      history.db,
    )

    expect(backend.setRetention({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
    })).toMatchObject({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
    })
    expect(backend.getState()).toMatchObject({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
    })
    history.close()
  })

  it('rolls semantic revocation back as one action when forgetting send audit fails', () => {
    const history = openTempDatabase()
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const optIns = new SemanticOptInStore(history.db)
    optIns.grant({ kind: 'workspace', id: 'w1' }, 'remote', 'm', 1)
    history.db.prepare(`
      INSERT INTO episodes(
        id, started_at_ms, ended_at_ms, start_reason, end_reason,
        primary_workspace_id, summary_kind, summary_text, confidence, state,
        created_at_ms, updated_at_ms
      ) VALUES ('remote-ep', 1, 2, 'first-observation', 'timeout',
        'w1', 'remote', 'derived', 0.5, 'closed', 1, 1)
    `).run()
    const sends = new RemoteSendStore(history.db)
    sends.record({
      episodeId: 'remote-ep',
      scopeKey: 'workspace:w1',
      endpointHost: 'models.example.test',
      model: 'm',
      payloadDigest: 'a'.repeat(64),
      sentAtMs: 2,
    })
    history.db.exec(`
      CREATE TRIGGER fail_send_forget
      BEFORE DELETE ON remote_summary_sends
      BEGIN
        SELECT RAISE(ABORT, 'forced send-forget failure');
      END;
    `)

    const backend = new LocalComputerHistoryBackend(
      new EpisodeStore(history.db),
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
      },
      undefined,
      optIns,
      history.db,
    )

    expect(() => backend.revokeSemanticOptIn({ scopeKey: 'workspace:w1' }))
      .toThrow(/forced send-forget failure/)
    expect(optIns.get({ kind: 'workspace', id: 'w1' })).toBeDefined()
    expect(history.db.prepare(
      'SELECT id FROM episodes WHERE id = ?',
    ).get('remote-ep')).toEqual({ id: 'remote-ep' })
    expect(sends.listForScope('workspace:w1')).toHaveLength(1)
    history.close()
  })

  it('drains in-flight capture recovery and refuses new controls once disposal starts', async () => {
    const history = openTempDatabase()
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)

    let recoverStarted!: () => void
    let releaseRecover!: () => void
    const started = new Promise<void>(resolve => { recoverStarted = resolve })
    const recoverGate = new Promise<void>(resolve => { releaseRecover = resolve })
    const capture: CaptureController = {
      async pause() {},
      async resume() {},
      async recover() {
        recoverStarted()
        await recoverGate
      },
      getState() {
        return {
          enabled: true,
          capture: 'degraded' as const,
          accessibilityTrusted: false,
        }
      },
    }

    const backend = new LocalComputerHistoryBackend(
      new EpisodeStore(history.db),
      policies,
      new DeletionService(history.db),
      capture,
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
      },
      undefined,
      undefined,
      history.db,
    )

    const recovering = backend.recover()
    await started

    let drained = false
    const draining = backend.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)

    releaseRecover()
    await recovering
    await draining
    expect(drained).toBe(true)

    await expect(backend.pause()).rejects.toThrow(/disposing/)
    await expect(backend.resume()).rejects.toThrow(/disposing/)
    await expect(backend.recover()).rejects.toThrow(/disposing/)
    history.close()
  })

  it('refuses a delayed editor pairing publication once backend drain has begun', async () => {
    const history = openTempDatabase()
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const tokens = new CompanionTokenStore(history.db)
    const previous = tokens.rotate('editor', 1_000)

    const backend = new LocalComputerHistoryBackend(
      new EpisodeStore(history.db),
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        now: () => 2_000,
      },
      tokens,
      undefined,
      history.db,
    )

    await backend.drain()

    let published = false
    expect(() => backend.publishPairingRotation('editor', () => {
      published = true
    })).toThrow(/disposing/)
    expect(published).toBe(false)

    // A delayed installer finishing after drain must not invalidate the
    // credential that was working before teardown began.
    expect(tokens.verify('editor', previous)).toBe(true)
    expect(tokens.state('editor')).toEqual({
      paired: true,
      createdAtMs: 1_000,
    })
    history.close()
  })

  it('rolls pairing publication back if the handoff publisher fails', () => {
    const history = openTempDatabase()
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const tokens = new CompanionTokenStore(history.db)
    const previous = tokens.rotate('editor', 1_000)

    const backend = new LocalComputerHistoryBackend(
      new EpisodeStore(history.db),
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        now: () => 2_000,
      },
      tokens,
      undefined,
      history.db,
    )

    expect(() => backend.publishPairingRotation('editor', () => {
      throw new Error('forced bootstrap publication failure')
    })).toThrow(/forced bootstrap publication failure/)
    expect(tokens.verify('editor', previous)).toBe(true)
    expect(tokens.state('editor')).toEqual({
      paired: true,
      createdAtMs: 1_000,
    })
    history.close()
  })

  it('does not let an in-flight remote request recreate state after its scope is revoked', async () => {
    const history = openTempDatabase()
    const episodeId = seedEpisode(history)
    const episodes = new EpisodeStore(history.db)
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const optIns = new SemanticOptInStore(history.db)
    const backend = new LocalComputerHistoryBackend(
      episodes,
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        now: () => 5_000,
      },
      undefined,
      optIns,
      history.db,
    )
    backend.grantSemanticOptIn({
      scopeKey: 'workspace:alpha',
      providerKind: 'remote',
      model: 'm',
    })
    const citation = episodes.get(episodeId)?.summaryObservationIds[0]
    expect(citation).toBeDefined()

    let releaseResponse!: () => void
    let requestStarted!: () => void
    const started = new Promise<void>(resolve => {
      requestStarted = resolve
    })
    const response = new Promise<Response>(resolve => {
      releaseResponse = () => resolve(Response.json({
        summary: 'Too late.',
        citations: [Number(citation)],
      }))
    })

    const remote = backend.summariseRemotely({
      scopeKey: 'workspace:alpha',
      endpoint: 'https://models.example.test/v1',
      model: 'm',
      fetchImpl: async () => {
        requestStarted()
        return response
      },
    })
    await started

    expect(backend.revokeSemanticOptIn({
      scopeKey: 'workspace:alpha',
    })).toMatchObject({
      revoked: true,
      forgotten: 0,
    })
    expect(optIns.get({ kind: 'workspace', id: 'alpha' })).toBeUndefined()

    releaseResponse()
    await expect(remote).rejects.toThrow(/no recorded opt-in/)
    expect(new RemoteSendStore(history.db).listForScope('workspace:alpha'))
      .toHaveLength(0)
    history.close()
  })

  it('does not return a remote summary if consent is revoked while its response body is still streaming', async () => {
    const history = openTempDatabase()
    const episodeId = seedEpisode(history)
    const episodes = new EpisodeStore(history.db)
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const optIns = new SemanticOptInStore(history.db)
    const sends = new RemoteSendStore(history.db)
    const backend = new LocalComputerHistoryBackend(
      episodes,
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        now: () => 5_000,
      },
      undefined,
      optIns,
      history.db,
    )
    backend.grantSemanticOptIn({
      scopeKey: 'workspace:alpha',
      providerKind: 'remote',
      model: 'm',
    })
    const citation = episodes.get(episodeId)?.summaryObservationIds[0]
    expect(citation).toBeDefined()

    let releaseBody!: () => void
    const bodyGate = new Promise<void>(resolve => {
      releaseBody = resolve
    })
    let bodyStarted!: () => void
    const bodyHasStarted = new Promise<void>(resolve => {
      bodyStarted = resolve
    })

    const remote = backend.summariseRemotely({
      scopeKey: 'workspace:alpha',
      endpoint: 'https://models.example.test/v1',
      model: 'm',
      fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          bodyStarted()
          void bodyGate.then(() => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({
              summary: 'Too late after body read.',
              citations: [Number(citation)],
            })))
            controller.close()
          })
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    })

    await bodyHasStarted
    for (let i = 0; i < 10 && sends.listForScope('workspace:alpha').length === 0; i += 1) {
      await Promise.resolve()
    }
    expect(sends.listForScope('workspace:alpha')).toHaveLength(1)

    expect(backend.revokeSemanticOptIn({
      scopeKey: 'workspace:alpha',
    })).toMatchObject({
      revoked: true,
      forgotten: 1,
    })
    expect(sends.listForScope('workspace:alpha')).toHaveLength(0)

    releaseBody()
    await expect(remote).rejects.toThrow(/no recorded opt-in/)
    expect(sends.listForScope('workspace:alpha')).toHaveLength(0)
    history.close()
  })

  it('keeps a remote summary operation alive through drain until its send audit is durable', async () => {
    const history = openTempDatabase()
    const episodeId = seedEpisode(history)
    const episodes = new EpisodeStore(history.db)
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(1)
    const optIns = new SemanticOptInStore(history.db)
    const backend = new LocalComputerHistoryBackend(
      episodes,
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        now: () => 5_000,
      },
      undefined,
      optIns,
      history.db,
    )
    backend.grantSemanticOptIn({
      scopeKey: 'workspace:alpha',
      providerKind: 'remote',
      model: 'm',
    })
    const citation = episodes.get(episodeId)?.summaryObservationIds[0]
    expect(citation).toBeDefined()

    let releaseResponse!: () => void
    let requestStarted!: () => void
    const started = new Promise<void>(resolve => {
      requestStarted = resolve
    })
    const response = new Promise<Response>(resolve => {
      releaseResponse = () => resolve(Response.json({
        summary: 'Remote summary.',
        citations: [Number(citation)],
      }))
    })
    const remote = backend.summariseRemotely({
      scopeKey: 'workspace:alpha',
      endpoint: 'https://models.example.test/v1',
      model: 'm',
      fetchImpl: async () => {
        requestStarted()
        return response
      },
    })
    await started

    let drained = false
    const draining = backend.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    releaseResponse()
    await expect(remote).resolves.toMatchObject({
      summary: 'Remote summary.',
    })
    await draining
    expect(drained).toBe(true)
    expect(new RemoteSendStore(history.db).listForScope('workspace:alpha'))
      .toHaveLength(1)

    expect(() => backend.setRetention({
      observationRetentionHours: 6,
      episodeRetentionDays: 14,
    })).toThrow(/disposing/)
    history.close()
  })

  it('does not report import complete until the ingestion refresh has settled', async () => {
    const history = openTempDatabase()
    const episodes = new EpisodeStore(history.db)
    const policies = new PolicyStore(history.db)
    policies.ensureInitial(100)
    let refreshStarted = false
    let releaseRefresh!: () => void
    const refresh = new Promise<void>(resolve => {
      releaseRefresh = resolve
    })

    const backend = new LocalComputerHistoryBackend(
      episodes,
      policies,
      new DeletionService(history.db),
      new FakeCapture(),
      {
        observationRetentionHours: 24,
        episodeRetentionDays: 30,
        autoResume: false,
        onHistoryChanged: async () => {
          refreshStarted = true
          await refresh
        },
      },
      undefined,
      undefined,
      history.db,
    )

    let settled = false
    const importing = backend.importAll({
      schema: 'dsh-computer-history/v1',
      exportedAtMs: 1,
      schemaVersion: 8,
      tables: {},
    }).then(result => {
      settled = true
      return result
    })

    await Promise.resolve()
    expect(refreshStarted).toBe(true)
    expect(settled).toBe(false)
    releaseRefresh()
    await expect(importing).resolves.toEqual({ imported: {} })
    expect(settled).toBe(true)
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
      recordDshCheckpoint(request) { return request },
      latestDshCheckpoint() { return undefined },
      async delete() {
        return {
          observationsDeleted: 0,
          episodesDeleted: 0,
          episodesRebuilt: 0,
        }
      },
      async pause() {},
      async resume() {},
      async recover() {},
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
      async importAll() { return { imported: {} } },
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
