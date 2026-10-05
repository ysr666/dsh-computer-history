import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openHistoryDatabase, EpisodeStore } from '../../src/host/store/index.js'
import { IngestionService } from '../../src/host/ingestion/ingestion-service.js'
import { DeletionService } from '../../src/host/retention/deletion.js'
import { companionObservation } from '../../src/host/companion/observation.js'

// What `/recent` actually returns, and what a deletion does to it. `GET /recent` is
// `history.recent(...)` -> `EpisodeStore.listRecent({ sinceMs?, workspaceId?, limit: boundedLimit(limit, 5, 100) })`,
// so it answers with **episodes** and its default limit is **5** - which is why a delete on a store with more
// than five episodes looks like it changed nothing at all. That is what made me record "`/delete` succeeded and
// `/recent` did not shrink" during the adversarial pass; the observation was real and the conclusion I drew
// from it was wrong. This test is the definition of "consistent" that the plan asked for.

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

describe('recent lists episodes, and a deletion removes one', () => {
  it('drops the deleted episode from the list and keeps the others', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-recent-'))
    const handle = openHistoryDatabase({ dataDirectory: dir })
    const db = handle.db
    const base = Date.now() - 6 * 60 * 60 * 1000
    const ingestion = new IngestionService(
      db,
      { resolve: async () => ({ id: 'ws', root: '/tmp/ws', title: 'ws', source: 'dsh', confidence: 1 }) },
      () => policy,
      () => base + 10 * 60 * 60 * 1000,
    )
    // Three sessions an hour apart: episode boundaries come from idle gaps, so this yields three episodes.
    for (let session = 0; session < 3; session += 1) {
      for (let i = 0; i < 2; i += 1) {
        await ingestion.ingest(companionObservation({
          source: 'browser', origin: 'https://recent.test', path: `/session-${session}/${i}`,
          title: `session ${session} item ${i}`, incognito: false, browserSession: `recent-${session}`,
          seq: i + 1, observedAtMs: base + session * 60 * 60 * 1000 + i * 1000,
        }))
      }
    }
    const episodes = new EpisodeStore(db)
    const listed = episodes.listRecent({ limit: 100 })
    const withDefaultLimit = episodes.listRecent({})
    expect(listed.length).toBeGreaterThanOrEqual(2)
    // The default the route uses: this is the artefact that produced the old observation.
    expect(withDefaultLimit.length).toBeLessThanOrEqual(5)
    const victim = listed[0]
    // A run with nothing to delete would prove nothing, so it says so rather than passing quietly.
    if (victim === undefined) throw new Error('no episode was listed: this run proves nothing')
    new DeletionService(db).delete({ scope: { kind: 'episode', episodeId: victim.id } })
    const after = episodes.listRecent({ limit: 100 })
    expect(after.map(episode => episode.id)).not.toContain(victim.id)
    expect(after.length).toBe(listed.length - 1)
    handle.close()
  })
})
