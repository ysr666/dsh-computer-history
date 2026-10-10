import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openHistoryDatabase,
  EpisodeStore,
  ObservationStore,
} from '../../src/host/store/index.js'
import { EpisodeId } from '../../src/shared/index.js'
import { exportHistory, importHistory } from '../../src/host/audit/export.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('browser title redaction (upgrade and future reads)', () => {
  it('removes legacy URL title secrets from raw observations, resources and Episode summaries', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dch-browser-redact-'))
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const initial = openHistoryDatabase({ dataDirectory, nowMs: 100 })
    const db = initial.db
    const secret = '/account/page?token=do-not-store#session-3'
    db.prepare(`
      INSERT INTO resources(
        id, kind, canonical_uri, display_label, sensitivity,
        first_seen_at_ms, last_seen_at_ms
      ) VALUES(1, 'url', 'https://example.test/account/page', ?, 'normal', 10, 30)
    `).run(secret)
    db.prepare(`
      INSERT INTO observations(
        id, collector_session, collector_seq, observed_at_ms, pid,
        bundle_id, app_name, surface_kind, window_title,
        resource_id, workspace_source, workspace_confidence,
        privacy_secure, privacy_protected, source_provider,
        source_adapter, policy_revision, expires_at_ms
      ) VALUES(
        1, 'browser-legacy', 1, 10, 0, 'companion.browser',
        'Browser companion', 'browser', ?, 1, 'none', 0,
        0, 0, 'companion', 'browser', 1, 100000
      )
    `).run(secret)
    db.prepare(`
      INSERT INTO episodes(
        id, started_at_ms, ended_at_ms, start_reason, end_reason,
        primary_workspace_title, thread_key,
        summary_kind, summary_text, confidence, state,
        created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES(
        'episode:legacy-browser', 10, 30, 'first-observation', 'timeout',
        'Known project', 'workspace:known', 'local', ?,
        0.95, 'closed', 30, 30, 100000
      )
    `).run('Worked in Known project. Browser: ' + secret)
    db.prepare(`
      INSERT INTO episode_resources(
        episode_id, resource_id, first_seen_at_ms,
        last_seen_at_ms, observation_count
      ) VALUES('episode:legacy-browser', 1, 10, 30, 1)
    `).run()
    db.prepare(`
      INSERT INTO episode_surfaces(
        episode_id, bundle_id, surface_kind,
        first_seen_at_ms, last_seen_at_ms, observation_count
      ) VALUES('episode:legacy-browser', 'companion.browser', 'browser', 10, 30, 1)
    `).run()
    db.prepare(`
      INSERT INTO episode_observations(episode_id, observation_id)
      VALUES('episode:legacy-browser', 1)
    `).run()
    // Simulate an actual v14 store with legacy browser titles rather than
    // mutating or migrating the user's real personal database.
    db.prepare('DELETE FROM schema_migrations WHERE version = 15').run()
    db.exec('PRAGMA user_version = 14')
    initial.close()

    const upgraded = openHistoryDatabase({ dataDirectory, nowMs: 100 })
    const raw = upgraded.db.prepare(`
      SELECT window_title FROM observations WHERE id = 1
    `).get() as { window_title: string | null }
    expect(raw.window_title).toBeNull()
    expect(upgraded.db.prepare(
      "SELECT display_label FROM resources WHERE id = 1",
    ).get()).toEqual({ display_label: null })
    const observation = new ObservationStore(upgraded.db).listAll()[0]!
    expect(observation.surface.title).toBeUndefined()
    expect(observation.resource?.displayLabel).toBeUndefined()
    const episode = new EpisodeStore(upgraded.db).get(EpisodeId('episode:legacy-browser'))!
    expect(episode.resources[0]?.canonicalUri).toBe('https://example.test/account/page')
    expect(episode.summaryKind).toBe('deterministic')
    expect(episode.summary).toContain('Known project')
    expect(JSON.stringify(episode)).not.toContain('do-not-store')
    expect(JSON.stringify(episode)).not.toContain('?token=')
    expect(episode.surfaces[0]?.title).toBeUndefined()
    expect(upgraded.db.prepare('PRAGMA user_version').get()).toEqual({
      user_version: 15,
    })
    upgraded.close()

    const reopened = openHistoryDatabase({ dataDirectory, nowMs: 105 })
    expect(new EpisodeStore(reopened.db)
      .get(EpisodeId('episode:legacy-browser'))?.summary).toBe(episode.summary)
    reopened.close()
  })
  it('does not reintroduce old browser page secrets from a JSON audit backup', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dch-browser-import-'))
    roots.push(root)
    const source = openHistoryDatabase({
      dataDirectory: path.join(root, 'source'), nowMs: 10,
    })
    const secret = 'auth-marker-unsafe'
    source.db.prepare(`
      INSERT INTO resources(
        kind, canonical_uri, display_label, first_seen_at_ms, last_seen_at_ms
      ) VALUES('url', ?, ?, 1, 2)
    `).run('https://user:password@example.test/task?token=' + secret + '#view',
      'Task?token=' + secret)
    const sourceResource = Number((source.db.prepare(
      "SELECT id FROM resources WHERE kind = 'url'",
    ).get() as { id: number }).id)
    source.db.prepare(`
      INSERT INTO observations(
        collector_session, collector_seq, observed_at_ms,
        pid, bundle_id, surface_kind, window_title, resource_id,
        workspace_source, workspace_confidence, privacy_secure,
        privacy_protected, source_provider, source_adapter,
        policy_revision, expires_at_ms
      ) VALUES('old-browser', 1, 1, 0, 'companion.browser', 'browser', ?,
        ?, 'none', 0, 0, 0, 'companion', 'browser', 1, 999999)
    `).run('Page?token=' + secret, sourceResource)
    const sourceObservation = Number((source.db.prepare(
      "SELECT id FROM observations WHERE collector_session='old-browser'",
    ).get() as { id: number }).id)
    source.db.prepare(`
      INSERT INTO episodes(
        id, started_at_ms, ended_at_ms, start_reason,
        end_reason, primary_workspace_title, thread_key,
        summary_kind, summary_text, confidence,
        state, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES('episode:import-browser', 1, 2, 'first-observation',
        'timeout', 'Browser work', 'workspace:import',
        'local', ?, 0.9, 'closed', 2, 2, 999999)
    `).run('Browser title contains ' + secret)
    source.db.prepare(`
      INSERT INTO episode_resources(
        episode_id, resource_id, first_seen_at_ms,
        last_seen_at_ms, observation_count
      ) VALUES('episode:import-browser', ?, 1, 2, 1)
    `).run(sourceResource)
    source.db.prepare(`
      INSERT INTO episode_surfaces(
        episode_id, bundle_id, surface_kind,
        first_seen_at_ms, last_seen_at_ms, observation_count
      ) VALUES('episode:import-browser', 'companion.browser', 'browser', 1, 2, 1)
    `).run()
    source.db.prepare(`
      INSERT INTO episode_observations(episode_id, observation_id)
      VALUES('episode:import-browser', ?)
    `).run(sourceObservation)
    source.db.prepare(`
      INSERT INTO episode_summary_citations(episode_id, observation_id)
      VALUES('episode:import-browser', ?)
    `).run(sourceObservation)
    const exported = exportHistory(source.db, 10)
    source.close()
    expect(JSON.stringify(exported)).toContain(secret)

    const target = openHistoryDatabase({
      dataDirectory: path.join(root, 'target'), nowMs: 10,
    })
    expect(importHistory(target.db, exported).imported.episodes).toBe(1)
    const restored = new EpisodeStore(target.db)
      .get(EpisodeId('episode:import-browser'))!
    const restoredObservation = new ObservationStore(target.db).listAll()[0]!
    expect(restored.resources[0]?.canonicalUri)
      .toBe('https://example.test/task')
    expect(restored.summaryKind).toBe('deterministic')
    expect(restored.summaryObservationIds).toHaveLength(1)
    expect(restoredObservation.surface.title).toBeUndefined()
    expect(restoredObservation.resource?.displayLabel).toBeUndefined()
    expect(JSON.stringify(restored)).not.toContain(secret)
    expect(JSON.stringify(restoredObservation)).not.toContain(secret)
    expect(JSON.stringify(restored)).not.toContain('password')
    // Reimporting the old backup cannot restore secrets through an existing
    // resource's display_label or a duplicate observation identity.
    expect(importHistory(target.db, exported).imported.episodes).toBe(0)
    expect((target.db.prepare(
      "SELECT display_label FROM resources WHERE kind='url'",
    ).get() as { display_label: string | null }).display_label).toBeNull()
    target.close()
  })

})
