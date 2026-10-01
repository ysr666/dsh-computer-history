import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  afterAll,
  describe,
  expect,
  it,
} from 'vitest'
import {
  PolicyRuleId,
  type NativeObservation,
} from '../../../src/shared/index.js'
import {
  IngestionService,
} from '../../../src/host/ingestion/index.js'
import {
  ObservationStore,
  openHistoryDatabase,
  PolicyStore,
} from '../../../src/host/store/index.js'

const root = mkdtempSync(
  path.join(os.tmpdir(), 'dsh-ch-benchmark-'),
)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('ingestion performance gate', () => {
  it('ingests 10k observations without quadratic rebuild', async () => {
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
      Date.now,
    )

    const started = performance.now()
    for (let index = 0; index < 10_000; index += 1) {
      const message: NativeObservation = {
        v: 1,
        type: 'observation',
        collectorSession: 'benchmark',
        seq: index + 1,
        observedAtMs: 1_000 + index * 100,
        app: {
          pid: 1,
          bundleId: 'com.microsoft.VSCode',
        },
        window: {
          title: 'file' + index,
          document:
            '/alpha/src/file'
            + (index % 20)
            + '.ts',
        },
        privacy: {
          secure: false,
          protected: false,
        },
        source: {
          adapter: 'vscode',
        },
      }
      // oxlint-disable-next-line no-await-in-loop -- benchmark models ordered collector delivery
      await ingestion.ingest(message)
    }

    const durationMs = performance.now() - started
    expect(
      new ObservationStore(history.db).count(),
    ).toBe(10_000)
    expect(durationMs).toBeLessThan(30_000)

    console.log(
      'INGEST_10000_MS',
      Math.round(durationMs),
    )
    history.close()
  }, 40_000)
})
