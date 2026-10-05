import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openHistoryDatabase } from '../../src/host/store/database.js'
import { IngestionService } from '../../src/host/ingestion/ingestion-service.js'
import { DeletionService } from '../../src/host/retention/deletion.js'
import { companionObservation } from '../../src/host/companion/observation.js'

const policy = {
  revision: 1,
  mode: 'include-only' as const,
  updatedAtMs: 1,
  rules: [
    {
      id: 'allow-companion' as never,
      dimension: 'app' as const,
      action: 'allow' as const,
      matcher: 'exact' as const,
      pattern: 'companion.browser',
      builtIn: false,
      createdAtMs: 1,
      updatedAtMs: 1,
    },
  ],
}

describe('deletion semantics, measured', () => {
  it('deletes an episode and does not bring it back on reseed', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-del-'))
    const handle = openHistoryDatabase({ dataDirectory: dir })
    const db = handle.db
    const now = 1_760_000_000_000
    const ingestion = new IngestionService(
      db,
      { resolve: async () => ({ id: 'e2e', root: '/tmp/e2e', title: 'e2e', source: 'dsh', confidence: 1 }) },
      () => policy,
      () => now,
    )
    for (let i = 0; i < 4; i += 1) {
      const payload = companionObservation({
        source: 'browser', origin: 'https://probe.test', path: `/probe/${i}`, title: `probe ${i}`,
        incognito: false, browserSession: 'probe-1', seq: i + 1, observedAtMs: now + i * 60_000,
      })
      await ingestion.ingest(payload)
    }
    const count = (table: string) => (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n
    const before = { episodes: count('episodes'), observations: count('observations'), links: count('episode_observations'), log: count('deletion_log') }
    expect(before).toMatchObject({ episodes: 1, observations: 1, log: 0 })
    const id = (db.prepare('select id from episodes limit 1').get() as { id: string } | undefined)?.id
    expect(id).toBeDefined()
    const result = new DeletionService(db).delete({ scope: { kind: 'episode', episodeId: id as never } }, now + 10_000)
    const after = { episodes: count('episodes'), observations: count('observations'), links: count('episode_observations'), log: count('deletion_log') }
    ingestion.reseed()
    const reseeded = { episodes: count('episodes'), observations: count('observations') }
    // The three observations that followed the first one carried timestamps ahead of `now`, and the Host
    // refuses those by name rather than storing them, so the episode is built from exactly one observation.
    expect([...ingestion.refusalCounts()]).toEqual([['future-timestamp', 3]])
    expect(result).toMatchObject({ observationsDeleted: 1, episodesDeleted: 1 })
    expect(after.observations).toBe(0)
    expect(after.episodes).toBe(0)
    expect(after.log).toBe(1)
    // The question this test exists for: a reseed after a deletion must not rebuild what was deleted. The
    // reseed replays the observations that remain, and the deleted episode's observations are gone.
    expect(reseeded.episodes).toBe(0)
    expect(reseeded.observations).toBe(0)
    expect(db.prepare('select scope from deletion_log').all()).toEqual([{ scope: 'episode' }])
    handle.close()
    // Every other spec here removes what it created, and this one runs on every `pnpm verify`.
    rmSync(dir, { recursive: true, force: true })
  })
})
