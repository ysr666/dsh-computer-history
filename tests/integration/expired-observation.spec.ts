import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openHistoryDatabase } from '../../src/host/store/database.js'
import { IngestionService } from '../../src/host/ingestion/ingestion-service.js'
import { companionObservation } from '../../src/host/companion/observation.js'
import { OBSERVATION_RETENTION_MS } from '../../src/shared/constants.js'

// Both sides of the retention window. An observation that arrives after the window has to be refused **by
// name** - `expired`, "arrived, but too late to be stored" - because a silent drop is indistinguishable from a
// machine nobody used, which is the failure this whole family of named refusals exists for. One that arrives
// just inside the window has to be stored, or the check would only prove that nothing is ever stored.

const policy = {
  revision: 1,
  mode: 'include-only' as const,
  updatedAtMs: 1,
  rules: [{
    id: 'allow-companion' as never,
    dimension: 'app' as const,
    action: 'allow' as const,
    matcher: 'exact' as const,
    pattern: 'companion.browser',
    builtIn: false,
    createdAtMs: 1,
    updatedAtMs: 1,
  }],
}

const payload = (observedAtMs: number) => companionObservation({
  source: 'browser', origin: 'https://expiry.test', path: '/expiry', title: 'expiry probe',
  incognito: false, browserSession: 'expiry-1', seq: 1, observedAtMs,
})

describe('the retention window', () => {
  it('refuses an expired observation by name and stores one inside the window', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-expiry-'))
    const handle = openHistoryDatabase({ dataDirectory: dir })
    const db = handle.db
    const now = Date.now()
    const ingestion = new IngestionService(
      db,
      { resolve: async () => ({ id: 'ws', root: '/tmp/ws', title: 'ws', source: 'dsh', confidence: 1 }) },
      () => policy,
      () => now,
    )
    const outside = await ingestion.ingest(payload(now - OBSERVATION_RETENTION_MS - 60_000))
    const inside = await ingestion.ingest(payload(now - OBSERVATION_RETENTION_MS + 60_000))
    const rows = (db.prepare('select count(*) as n from observations').get() as { n: number }).n
    expect(outside).toBe(false)
    expect(inside).toBe(true)
    expect(rows).toBe(1)
    expect([...ingestion.refusalCounts()]).toEqual([['expired', 1]])
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
