import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PolicyRuleId, type NativeObservation } from '../../src/shared/index.js'
import { parseCollectorLine } from '../../src/host/collector/protocol.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import { openHistoryDatabase, PolicyStore } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** The line a Linux collector really sent, captured 2026-10-05 (Ubuntu 24.04 in a VM, aarch64). */
const LINUX_LINE =
  '{"v":1,"type":"observation","collectorSession":"linux-43178","seq":1,"observedAtMs":1791140773498,"app":{"pid":6466,"bundleId":"org.gnome.Terminal.desktop","name":"gnome-terminal-server"},"window":{"title":null,"document":null,"url":null},"element":{"role":"terminal","subrole":null,"identifier":null},"privacy":{"secure":false,"protected":false},"source":{"adapter":"terminal","provider":"at-spi"}}'

/** Parsed the way the host parses it, so the test covers the wire shape and not a hand-built object. */
function linuxObservation(): NativeObservation {
  return parseCollectorLine(LINUX_LINE) as NativeObservation
}

function harness(root: string) {
  const history = openHistoryDatabase({ dataDirectory: root })
  const policies = new PolicyStore(history.db)
  policies.ensureInitial(1)
  const ingestion = new IngestionService(
    history.db,
    {
      resolve: async () => ({
        id: 'alpha',
        root,
        title: 'alpha',
        source: 'dsh' as const,
        confidence: 1,
      }),
    },
    () => policies.get(),
    () => 1_791_140_780_000,
  )
  return { history, policies, ingestion }
}

function allowTerminal(policies: PolicyStore): void {
  policies.replace(
    'include-only',
    [{
      id: PolicyRuleId('linuxrow-terminal'),
      dimension: 'app' as const,
      action: 'allow' as const,
      matcher: 'exact' as const,
      pattern: 'org.gnome.Terminal.desktop',
      builtIn: false,
      createdAtMs: 1_500,
      updatedAtMs: 1_500,
    }],
    1_500,
  )
}

describe('the Linux row', () => {
  it('stores the observation a Linux collector sends', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'linuxrow-'))
    roots.push(root)
    const { history, policies, ingestion } = harness(root)
    allowTerminal(policies)

    expect(await ingestion.ingest(linuxObservation())).toBe(true)
    const rows = history.db.prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number }
    expect(rows.n).toBe(1)
    expect(Object.fromEntries(ingestion.refusalCounts())).toEqual({})
    history.db.close()
  })

  it('tolerates the clock skew a collector on another machine has, and names what it will not', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'linuxrow-skew-'))
    roots.push(root)
    const { history, policies, ingestion } = harness(root)
    allowTerminal(policies)

    // Measured: the VM's clock ran 354 ms ahead of its host. A collector on another machine always has some
    // skew, and the host used to discard those observations silently.
    const slightlyAhead = { ...linuxObservation(), observedAtMs: 1_791_140_780_000 + 900 }
    expect(await ingestion.ingest(slightlyAhead)).toBe(true)

    // Far enough ahead that it is not skew: refused, and by name.
    const absurd = { ...linuxObservation(), seq: 2, observedAtMs: 1_791_140_780_000 + 600_000 }
    expect(await ingestion.ingest(absurd)).toBe(false)
    expect(ingestion.refusalCounts().get('future-timestamp')).toBe(1)
    expect(ingestion.refusalCounts().get('unknown')).toBeUndefined()
    history.db.close()
  })
})
