import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PolicyRuleId,
  type NativeObservation,
} from '../../src/shared/index.js'
import { exportHistory, importHistory } from '../../src/host/audit/export.js'
import { CompanionTokenStore } from '../../src/host/companion/token-store.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import { DeletionService, RetentionService } from '../../src/host/retention/index.js'
import {
  EpisodeStore,
  ObservationStore,
  openHistoryDatabase,
  PolicyStore,
  ResourceStore,
} from '../../src/host/store/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function database(label: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), `dsh-ch-fault-${label}-`))
  roots.push(root)
  return openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
}

function allowedPolicy(db: ReturnType<typeof database>['db']): PolicyStore {
  const policies = new PolicyStore(db)
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
  return policies
}

function message(session: string, atMs = 1_000, seq = 1): NativeObservation {
  return {
    v: 1,
    type: 'observation',
    collectorSession: session,
    seq,
    observedAtMs: atMs,
    app: {
      pid: 7,
      bundleId: 'com.microsoft.VSCode',
      name: 'Code',
    },
    window: {
      title: 'fault.ts',
      document: '/tmp/fault.ts',
    },
    privacy: {
      secure: false,
      protected: false,
    },
    source: {
      adapter: 'vscode',
    },
  }
}

function ingestion(
  db: ReturnType<typeof database>['db'],
  policies: PolicyStore,
  now = 1_000,
  observationRetentionMs = 86_400_000,
  episodeRetentionMs = 30 * 86_400_000,
): IngestionService {
  return new IngestionService(
    db,
    { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
    () => policies.get(),
    () => now,
    () => observationRetentionMs,
    () => episodeRetentionMs,
  )
}

function count(
  db: ReturnType<typeof database>['db'],
  table: string,
): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  return Number(row.n)
}

describe('SQLite fault injection', () => {
  it('rolls ingestion back and reseeds its in-memory builder before the same sequence retries', async () => {
    const history = database('ingest')
    const policies = allowedPolicy(history.db)
    const service = ingestion(history.db, policies)

    history.db.exec(`
      CREATE TRIGGER fail_episode_insert
      BEFORE INSERT ON episodes
      BEGIN
        SELECT RAISE(ABORT, 'forced episode insert failure');
      END;
    `)

    await expect(service.ingest(message('fault-ingest')))
      .rejects.toThrow(/forced episode insert failure/)
    expect(count(history.db, 'observations')).toBe(0)
    expect(count(history.db, 'episodes')).toBe(0)
    expect(count(history.db, 'resources')).toBe(0)

    history.db.exec('DROP TRIGGER fail_episode_insert')
    await expect(service.ingest(message('fault-ingest'))).resolves.toBe(true)
    expect(new ObservationStore(history.db).count()).toBe(1)
    expect(new EpisodeStore(history.db).listRecent()).toHaveLength(1)
    history.close()
  })

  it('rolls a user deletion back when its final audit write fails', async () => {
    const history = database('delete')
    const policies = allowedPolicy(history.db)
    const service = ingestion(history.db, policies)
    await service.ingest(message('fault-delete'))

    const before = {
      observations: count(history.db, 'observations'),
      episodes: count(history.db, 'episodes'),
      resources: count(history.db, 'resources'),
    }

    history.db.exec(`
      CREATE TRIGGER fail_deletion_audit
      BEFORE INSERT ON deletion_log
      BEGIN
        SELECT RAISE(ABORT, 'forced deletion audit failure');
      END;
    `)

    const deletion = new DeletionService(history.db)
    expect(() => deletion.delete({ scope: { kind: 'all' } }, 2_000))
      .toThrow(/forced deletion audit failure/)
    expect(count(history.db, 'observations')).toBe(before.observations)
    expect(count(history.db, 'episodes')).toBe(before.episodes)
    expect(count(history.db, 'resources')).toBe(before.resources)
    expect(count(history.db, 'deletion_log')).toBe(0)

    history.db.exec('DROP TRIGGER fail_deletion_audit')
    expect(deletion.delete({ scope: { kind: 'all' } }, 2_001))
      .toMatchObject({
        observationsDeleted: before.observations,
      })
    expect(count(history.db, 'observations')).toBe(0)
    history.close()
  })

  it('rolls an import back when a late Episode insert fails', async () => {
    const source = database('import-source')
    const sourcePolicies = allowedPolicy(source.db)
    await ingestion(source.db, sourcePolicies).ingest(message('fault-import'))
    const document = exportHistory(source.db, 2_000)

    const target = database('import-target')
    target.db.exec(`
      CREATE TRIGGER fail_import_episode
      BEFORE INSERT ON episodes
      BEGIN
        SELECT RAISE(ABORT, 'forced imported episode failure');
      END;
    `)

    expect(() => importHistory(target.db, document))
      .toThrow(/forced imported episode failure/)
    expect(count(target.db, 'resources')).toBe(0)
    expect(count(target.db, 'observations')).toBe(0)
    expect(count(target.db, 'episodes')).toBe(0)

    target.db.exec('DROP TRIGGER fail_import_episode')
    expect(importHistory(target.db, document).imported.observations).toBe(1)
    expect(count(target.db, 'observations')).toBe(1)
    source.close()
    target.close()
  })

  it('restores the old policy if the final revision update aborts', () => {
    const history = database('policy')
    const policies = allowedPolicy(history.db)
    const before = policies.get()

    history.db.exec(`
      CREATE TRIGGER fail_policy_revision
      BEFORE UPDATE ON policy_state
      BEGIN
        SELECT RAISE(ABORT, 'forced policy revision failure');
      END;
    `)

    expect(() => policies.replace('include-only', [{
      id: PolicyRuleId('allow-other'),
      dimension: 'app',
      action: 'deny',
      matcher: 'exact',
      pattern: 'com.example.Other',
      builtIn: false,
      createdAtMs: 10,
      updatedAtMs: 10,
    }], 10)).toThrow(/forced policy revision failure/)

    expect(policies.get()).toEqual(before)
    history.close()
  })

  it('restores observations and Episodes when retention fails after raw deletion begins', async () => {
    const history = database('retention')
    const policies = allowedPolicy(history.db)
    const service = ingestion(history.db, policies, 1_000, 1, 1)
    await service.ingest(message('fault-retention', 1_000))

    expect(count(history.db, 'observations')).toBe(1)
    expect(count(history.db, 'episodes')).toBe(1)

    history.db.exec(`
      CREATE TRIGGER fail_episode_retention
      BEFORE DELETE ON episodes
      BEGIN
        SELECT RAISE(ABORT, 'forced episode retention failure');
      END;
    `)

    expect(() => new RetentionService(history.db).sweep(1_002))
      .toThrow(/forced episode retention failure/)
    expect(count(history.db, 'observations')).toBe(1)
    expect(count(history.db, 'episodes')).toBe(1)

    history.db.exec('DROP TRIGGER fail_episode_retention')
    expect(new RetentionService(history.db).sweep(1_002)).toEqual({
      observationsDeleted: 1,
      episodesDeleted: 1,
    })
    history.close()
  })

  it('does not replace the in-memory pairing token when SQLite rejects rotation', () => {
    const history = database('pairing')
    const tokens = new CompanionTokenStore(history.db)
    const original = tokens.rotate('browser', 1_000)

    history.db.exec(`
      CREATE TRIGGER fail_pairing_rotation
      BEFORE UPDATE ON companion_pairing
      WHEN NEW.kind = 'browser'
      BEGIN
        SELECT RAISE(ABORT, 'forced pairing rotation failure');
      END;
    `)

    expect(() => tokens.rotate('browser', 2_000))
      .toThrow(/forced pairing rotation failure/)
    expect(tokens.verify('browser', original)).toBe(true)
    expect(tokens.state('browser')).toEqual({
      paired: true,
      createdAtMs: 1_000,
    })

    history.db.exec('DROP TRIGGER fail_pairing_rotation')
    const replacement = tokens.rotate('browser', 3_000)
    expect(tokens.verify('browser', original)).toBe(false)
    expect(tokens.verify('browser', replacement)).toBe(true)
    history.close()
  })
})
