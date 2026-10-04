import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PolicyRuleId,
  type NativeObservation,
  isFirstRunPreset,
  presetBundles,
} from '../../src/shared/index.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import { openHistoryDatabase, PolicyStore } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function shippedPresetBundles(): readonly string[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../../presets/first-run.json', import.meta.url), 'utf8'),
  )
  if (!isFirstRunPreset(raw)) throw new Error('presets/first-run.json is not a preset')
  return presetBundles(raw)
}

function native(bundleId: string): NativeObservation {
  return {
    v: 1,
    type: 'observation',
    collectorSession: 'preset-1',
    seq: 1,
    observedAtMs: 1_000,
    app: { pid: 1, bundleId },
    window: { title: 'provider.ts', document: '/alpha/src/provider.ts' },
    source: { adapter: 'vscode', provider: 'macos-ax' },
    privacy: { secure: false, protected: false },
  }
}

function harness(root: string) {
  const workspace = path.join(root, 'alpha')
  mkdirSync(path.join(workspace, 'src'), { recursive: true })
  const history = openHistoryDatabase({ dataDirectory: root })
  const policies = new PolicyStore(history.db)
  policies.ensureInitial(1)
  const ingestion = new IngestionService(
    history.db,
    {
      resolve: async () => ({
        id: 'alpha',
        root: workspace,
        title: 'alpha',
        source: 'dsh' as const,
        confidence: 1,
      }),
    },
    () => policies.get(),
    () => 2_000,
  )
  return { history, policies, ingestion, workspace }
}

/** The panel applies the preset by posting allow rules - the same shape a user's rule has. */
function applyPreset(policies: PolicyStore, bundles: readonly string[]): void {
  const now = 1_500
  policies.replace(
    'include-only',
    bundles.map((bundle, index) => ({
      id: PolicyRuleId(`preset-${index}`),
      dimension: 'app' as const,
      action: 'allow' as const,
      matcher: 'exact' as const,
      pattern: bundle,
      builtIn: false,
      createdAtMs: now,
      updatedAtMs: now,
    })),
    now,
  )
}

describe('the first-run preset, applied the way the panel applies it', () => {
  it('lets an allowed editor be recorded, on a store that recorded nothing before', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'preset-'))
    roots.push(root)
    const { history, policies, ingestion } = harness(root)

    expect(await ingestion.ingest(native('com.microsoft.VSCode'))).toBe(false)

    applyPreset(policies, shippedPresetBundles())
    expect(await ingestion.ingest(native('com.microsoft.VSCode'))).toBe(true)

    const rows = history.db
      .prepare('SELECT COUNT(*) AS n FROM observations')
      .get() as { n: number }
    expect(rows.n).toBe(1)
    history.db.close()
  })

  it('still refuses a protected application, and says why', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'preset-'))
    roots.push(root)
    const { history, policies, ingestion } = harness(root)
    applyPreset(policies, shippedPresetBundles())

    expect(await ingestion.ingest(native('com.1password.1password'))).toBe(false)
    const reasons = Object.fromEntries(ingestion.refusalCounts())
    expect(reasons['protected-app']).toBe(1)
    history.db.close()
  })

  it('does not count a duplicate the collector re-sent as a refusal', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'preset-'))
    roots.push(root)
    const { history, policies, ingestion } = harness(root)
    applyPreset(policies, shippedPresetBundles())

    expect(await ingestion.ingest(native('com.microsoft.VSCode'))).toBe(true)
    // The collector re-sends the same (session, seq) when a tick repeats: nothing is stored and nothing
    // is refused, so the panel must not report a refusal for it.
    expect(await ingestion.ingest(native('com.microsoft.VSCode'))).toBe(false)

    expect(Object.fromEntries(ingestion.refusalCounts())).toEqual({})
    const rows = history.db
      .prepare('SELECT COUNT(*) AS n FROM observations')
      .get() as { n: number }
    expect(rows.n).toBe(1)
    history.db.close()
  })

  it('names a browser seen through Accessibility without the companion', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'preset-'))
    roots.push(root)
    const { history, policies, ingestion } = harness(root)
    applyPreset(policies, shippedPresetBundles())

    // The shape a buggy or hostile collector could send: an http(s) document from the Accessibility
    // path. Only a paired companion may claim a URL (ADR 0007).
    const browser: NativeObservation = {
      ...native('com.microsoft.VSCode'),
      window: { title: 'Inbox', url: 'https://example.com/inbox' },
    }
    expect(await ingestion.ingest(browser)).toBe(false)

    // Not a silent skip: the advice is "pair the companion", and an unattributed count cannot say that.
    expect(ingestion.refusalCounts().get('browser-unpaired')).toBe(1)
    expect(ingestion.refusalCounts().get('unknown')).toBeUndefined()
    history.db.close()
  })

  it('records nothing outside the preset', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'preset-'))
    roots.push(root)
    const { history, policies, ingestion } = harness(root)
    applyPreset(policies, shippedPresetBundles())

    // Not an adapter at all: the preset must not have widened what this build understands.
    expect(await ingestion.ingest(native('com.example.not-an-adapter'))).toBe(false)
    const rows = history.db.prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number }
    expect(rows.n).toBe(0)
    history.db.close()
  })
})
