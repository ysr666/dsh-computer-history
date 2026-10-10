import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openHistoryDatabase } from '../../src/host/store/index.js'
import { EpisodeId } from '../../src/shared/index.js'
import { EpisodeStore } from '../../src/host/store/episode-store.js'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('legacy URL normalization collision in schema 15', () => {
  it('merges two resource identities without dropping Episode links or provenance', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dch-legacy-urls-'))
    roots.push(dir)
    const dataDirectory = path.join(dir, 'history')
    const store = openHistoryDatabase({ dataDirectory, nowMs: 10 })
    const db = store.db
    db.prepare("INSERT INTO resources(id, kind, canonical_uri, display_label, first_seen_at_ms, last_seen_at_ms) VALUES(1,'url', ?, ?, 1, 3)")
      .run('https://person:password@example.test/docs?token=secret#part', 'old?token=secret')
    db.prepare("INSERT INTO resources(id, kind, canonical_uri, display_label, first_seen_at_ms, last_seen_at_ms) VALUES(2,'url', 'https://example.test/docs', 'docs', 2, 4)").run()
    db.prepare("INSERT INTO episodes(id, started_at_ms, ended_at_ms, start_reason, end_reason, summary_kind, summary_text, confidence, state, created_at_ms, updated_at_ms) VALUES('ep1', 1, 4, 'first-observation', 'timeout', 'local', 'secret page', 1, 'closed', 1, 4)").run()
    db.prepare("INSERT INTO episode_resources(episode_id, resource_id, first_seen_at_ms, last_seen_at_ms, observation_count) VALUES('ep1',1,1,3,2)").run()
    db.prepare("INSERT INTO episode_resources(episode_id, resource_id, first_seen_at_ms, last_seen_at_ms, observation_count) VALUES('ep1',2,2,4,3)").run()
    db.prepare('DELETE FROM schema_migrations WHERE version=15').run()
    db.exec('PRAGMA user_version=14')
    store.close()

    const updated = openHistoryDatabase({ dataDirectory, nowMs: 10 })
    expect(updated.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(updated.db.prepare('SELECT COUNT(*) AS n FROM resources').get()).toEqual({ n: 1 })
    const resource = updated.db.prepare('SELECT canonical_uri, display_label FROM resources').get()
    expect(resource).toEqual({ canonical_uri: 'https://example.test/docs', display_label: null })
    const episode = new EpisodeStore(updated.db).get(EpisodeId('ep1'))!
    expect(episode.resources).toHaveLength(1)
    expect(episode.resources[0]?.observationCount).toBe(5)
    expect(episode.summaryKind).toBe('deterministic')
    expect(JSON.stringify(episode)).not.toContain('secret')
    expect(JSON.stringify(episode)).not.toContain('password')
    updated.close()
  })
})
