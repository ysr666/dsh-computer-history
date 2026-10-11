import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  exportHistory,
  importHistory,
  HistoryImportError,
} from '../../src/host/audit/export.js'
import { openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function database(prefix: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
}

/** A small but complete store: policy, resource, observation, episode, citation. */
function seed(db: ReturnType<typeof database>['db']): void {
  const now = 1
  db.prepare(`INSERT INTO policy_state(mode, revision, updated_at_ms) VALUES ('include-only', 1, ?)`).run(now)
  db.prepare(`INSERT INTO policy_rules(id, dimension, action, matcher, pattern, built_in, created_at_ms, updated_at_ms)
    VALUES ('allow-vscode', 'app', 'allow', 'exact', 'com.microsoft.VSCode', 0, ?, ?)`).run(now, now)
  db.prepare(`INSERT INTO resources(id, kind, canonical_uri, display_label, first_seen_at_ms, last_seen_at_ms)
    VALUES (1, 'file', 'file:///alpha/src/provider.ts', 'provider.ts', ?, ?)`).run(now, now)
  db.prepare(`INSERT INTO observations(id, collector_session, collector_seq, observed_at_ms, pid, bundle_id, surface_kind,
    resource_id, workspace_source, workspace_confidence, privacy_secure, privacy_protected, source_provider, source_adapter,
    policy_revision, expires_at_ms)
    VALUES (1, 'session', 1, ?, 7, 'com.microsoft.VSCode', 'editor', 1, 'none', 0, 0, 0, 'macos-ax', 'vscode', 1, 999999999999)`).run(now)
  db.prepare(`INSERT INTO episodes(id, started_at_ms, ended_at_ms, start_reason, end_reason, summary_kind, summary_text,
    confidence, state, created_at_ms, updated_at_ms)
    VALUES ('ep1', ?, ?, 'first-observation', 'timeout', 'deterministic', 'Worked on provider.ts.', 0.9, 'closed', ?, ?)`).run(now, now, now, now)
  db.prepare(`INSERT INTO episode_observations(episode_id, observation_id) VALUES ('ep1', 1)`).run()
  db.prepare(`INSERT INTO episode_resources(episode_id, resource_id, first_seen_at_ms, last_seen_at_ms, observation_count)
    VALUES ('ep1', 1, ?, ?, 1)`).run(now, now)
  db.prepare(`INSERT INTO episode_summary_citations(episode_id, observation_id) VALUES ('ep1', 1)`).run()
  db.prepare(`INSERT INTO semantic_opt_ins(scope_key, provider_kind, model, created_at_ms)
    VALUES ('workspace:w1', 'local', 'llama3', ?)`).run(now)
  // Companion credentials must never leave in an export. Keep both kinds here
  // so the privacy assertion follows migration 0008 rather than the old singleton shape.
  db.prepare(`INSERT INTO companion_pairing(kind, token_hash, created_at_ms)
    VALUES ('browser', 'deadbeef-browser', ?), ('editor', 'deadbeef-editor', ?)`
  ).run(now, now)
}

function seedIndependentLocalHistory(db: ReturnType<typeof database>['db']): void {
  const now = 2
  db.prepare(`INSERT INTO policy_state(mode, revision, updated_at_ms) VALUES ('include-only', 7, ?)`).run(now)
  db.prepare(`INSERT INTO policy_rules(id, dimension, action, matcher, pattern, built_in, created_at_ms, updated_at_ms)
    VALUES ('local-only', 'app', 'allow', 'exact', 'com.apple.finder', 0, ?, ?)`).run(now, now)
  db.prepare(`INSERT INTO resources(id, kind, canonical_uri, display_label, first_seen_at_ms, last_seen_at_ms)
    VALUES (1, 'file', 'file:///local/keep.txt', 'keep.txt', ?, ?)`).run(now, now)
  db.prepare(`INSERT INTO observations(id, collector_session, collector_seq, observed_at_ms, pid, bundle_id, surface_kind,
    resource_id, workspace_source, workspace_confidence, privacy_secure, privacy_protected, source_provider, source_adapter,
    policy_revision, expires_at_ms)
    VALUES (1, 'local-session', 1, ?, 8, 'com.apple.finder', 'window', 1, 'none', 0, 0, 0, 'macos-ax', 'finder', 7, 999999999999)`).run(now)
  db.prepare(`INSERT INTO episodes(id, started_at_ms, ended_at_ms, start_reason, end_reason, summary_kind, summary_text,
    confidence, state, created_at_ms, updated_at_ms)
    VALUES ('local-ep', ?, ?, 'first-observation', 'timeout', 'deterministic', 'Local history that must survive.', 0.9, 'closed', ?, ?)`).run(now, now, now, now)
  db.prepare(`INSERT INTO episode_observations(episode_id, observation_id) VALUES ('local-ep', 1)`).run()
  db.prepare(`INSERT INTO episode_resources(episode_id, resource_id, first_seen_at_ms, last_seen_at_ms, observation_count)
    VALUES ('local-ep', 1, ?, ?, 1)`).run(now, now)
  db.prepare(`INSERT INTO episode_summary_citations(episode_id, observation_id) VALUES ('local-ep', 1)`).run()
  db.prepare(`INSERT INTO semantic_opt_ins(scope_key, provider_kind, model, created_at_ms)
    VALUES ('workspace:local', 'remote', 'local-model', ?)`).run(now)
}

function counts(db: ReturnType<typeof database>['db']) {
  return {
    resources: Number((db.prepare('SELECT COUNT(*) AS n FROM resources').get() as { n: number }).n),
    observations: Number((db.prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number }).n),
    episodes: Number((db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }).n),
    citations: Number((db.prepare('SELECT COUNT(*) AS n FROM episode_summary_citations').get() as { n: number }).n),
    rules: Number((db.prepare('SELECT COUNT(*) AS n FROM policy_rules').get() as { n: number }).n),
    optIns: Number((db.prepare('SELECT COUNT(*) AS n FROM semantic_opt_ins').get() as { n: number }).n),
  }
}

describe('audit export and import', () => {
  it('round-trips a store into an empty one', () => {
    const source = database('dsh-ch-export-src-')
    seed(source.db)
    const document = exportHistory(source.db, 5_000)
    source.close()

    const target = database('dsh-ch-export-dst-')
    const before = counts(target.db)
    expect(before).toMatchObject({ resources: 0, observations: 0, episodes: 0 })

    const result = importHistory(target.db, document)

    expect(counts(target.db)).toEqual({
      resources: 1,
      observations: 1,
      episodes: 1,
      citations: 1,
      rules: 0,
      optIns: 0,
    })
    expect(result.imported.episodes).toBe(1)
    expect(result.imported.policy_rules).toBe(0)
    expect(result.imported.semantic_opt_ins).toBe(0)
    // Export is an audit document, but importing history must not grant this device capture or remote-send
    // permissions merely because the source device had them.
    expect(target.db.prepare('SELECT COUNT(*) AS n FROM policy_rules').get()).toEqual({ n: 0 })
    expect(target.db.prepare('SELECT COUNT(*) AS n FROM semantic_opt_ins').get()).toEqual({ n: 0 })
    // The episode's provenance survived, so a reader can still check it.
    const episode = (target.db.prepare('SELECT summary_text, summary_kind FROM episodes WHERE id = ?')
      .get('ep1')) as { summary_text: string, summary_kind: string }
    expect(episode.summary_text).toBe('Worked on provider.ts.')
    expect(episode.summary_kind).toBe('deterministic')
    expect(
      target.db.prepare('SELECT observation_id FROM episode_summary_citations WHERE episode_id = ?')
        .all('ep1'),
    ).toEqual([{ observation_id: 1 }])
    target.close()
  })

  it('merges two non-empty independent stores without replacing colliding numeric ids', () => {
    const source = database('dsh-ch-export-merge-src-')
    seed(source.db)
    const document = exportHistory(source.db, 5_000)
    source.close()

    const target = database('dsh-ch-export-merge-dst-')
    seedIndependentLocalHistory(target.db)

    const result = importHistory(target.db, document)

    expect(counts(target.db)).toEqual({
      resources: 2,
      observations: 2,
      episodes: 2,
      citations: 2,
      rules: 1,
      optIns: 1,
    })
    expect(result.imported.resources).toBe(1)
    expect(result.imported.observations).toBe(1)
    expect(result.imported.episodes).toBe(1)

    const localObservation = target.db.prepare(
      'SELECT id, resource_id FROM observations WHERE collector_session = ?',
    ).get('local-session') as { id: number, resource_id: number }
    expect(localObservation).toEqual({ id: 1, resource_id: 1 })
    expect(target.db.prepare(
      'SELECT observation_id FROM episode_observations WHERE episode_id = ?',
    ).all('local-ep')).toEqual([{ observation_id: 1 }])
    expect(target.db.prepare(
      'SELECT observation_id FROM episode_summary_citations WHERE episode_id = ?',
    ).all('local-ep')).toEqual([{ observation_id: 1 }])

    const importedResource = target.db.prepare(
      'SELECT id FROM resources WHERE canonical_uri = ?',
    ).get('file:///alpha/src/provider.ts') as { id: number }
    const importedObservation = target.db.prepare(
      'SELECT id, resource_id FROM observations WHERE collector_session = ?',
    ).get('session') as { id: number, resource_id: number }
    expect(importedResource.id).not.toBe(1)
    expect(importedObservation.id).not.toBe(1)
    expect(importedObservation.resource_id).toBe(importedResource.id)
    expect(target.db.prepare(
      'SELECT observation_id FROM episode_observations WHERE episode_id = ?',
    ).all('ep1')).toEqual([{ observation_id: importedObservation.id }])
    expect(target.db.prepare(
      'SELECT observation_id FROM episode_summary_citations WHERE episode_id = ?',
    ).all('ep1')).toEqual([{ observation_id: importedObservation.id }])

    // The source file contained different permission rows; history merge does not import them.
    expect(target.db.prepare(
      'SELECT id FROM policy_rules ORDER BY id',
    ).all()).toEqual([{ id: 'local-only' }])
    expect(target.db.prepare(
      'SELECT scope_key FROM semantic_opt_ins ORDER BY scope_key',
    ).all()).toEqual([{ scope_key: 'workspace:local' }])
    target.close()
  })

  it('refuses a partial observation row when its session/seq already exists locally', () => {
    const source = database('dsh-ch-export-partial-src-')
    seed(source.db)
    const document = exportHistory(source.db, 5_000)
    source.close()

    const target = database('dsh-ch-export-partial-dst-')
    importHistory(target.db, document)

    const partial = structuredClone(document) as unknown as {
      tables: Record<string, Array<Record<string, unknown>>>
    }
    delete partial.tables.observations?.[0]?.bundle_id

    expect(() => importHistory(target.db, partial))
      .toThrow(/observations\.bundle_id is required/)
    expect(counts(target.db)).toEqual({
      resources: 1,
      observations: 1,
      episodes: 1,
      citations: 1,
      rules: 0,
      optIns: 0,
    })
    target.close()
  })

  it('is idempotent for the same document', () => {
    const source = database('dsh-ch-export-same-')
    seed(source.db)
    const document = exportHistory(source.db, 5_000)
    importHistory(source.db, document)
    expect(counts(source.db)).toEqual({
      resources: 1,
      observations: 1,
      episodes: 1,
      citations: 1,
      rules: 1,
      optIns: 1,
    })
    source.close()
  })

  it('exports remote-send audit facts but never imports them as local history', () => {
    const source = database('dsh-ch-export-remote-audit-src-')
    seed(source.db)
    source.db.prepare(`
      INSERT INTO remote_summary_sends(
        episode_id, scope_key, endpoint_host, model, payload_digest, sent_at_ms
      ) VALUES ('ep1', 'workspace:w1', 'models.example.test', 'm', ?, 6)
    `).run('a'.repeat(64))

    const document = exportHistory(source.db, 5_000)
    expect(document.tables.remote_summary_sends).toEqual([{
      id: 1,
      episode_id: 'ep1',
      scope_key: 'workspace:w1',
      endpoint_host: 'models.example.test',
      model: 'm',
      payload_digest: 'a'.repeat(64),
      sent_at_ms: 6,
    }])
    source.close()

    const target = database('dsh-ch-export-remote-audit-dst-')
    const result = importHistory(target.db, document)
    expect(result.imported.remote_summary_sends).toBe(0)
    expect(target.db.prepare(
      'SELECT COUNT(*) AS n FROM remote_summary_sends',
    ).get()).toEqual({ n: 0 })
    target.close()
  })

  it('rebuilds the compacted event index from imported linked raw observations, ignoring forged aggregate counts', () => {
    const source = database('dch-restorable-raw-src-')
    seed(source.db)
    source.db.prepare("UPDATE observations SET activity_event='save' WHERE id=1").run()
    source.db.prepare(
      'INSERT INTO episode_saved_resources(episode_id, resource_id, first_changed_at_ms, last_changed_at_ms, change_count) VALUES (?, ?, ?, ?, ?)',
    ).run('ep1', 1, 1, 1, 1)

    const document = structuredClone(exportHistory(source.db, 5000)) as unknown as {
      tables: Record<string, Array<Record<string, unknown>>>
    }
    // The copied compacted summary is deliberately untrusted. It must not
    // change the restored, independently recomputed linked raw-event count.
    document.tables.episode_saved_resources![0]!.change_count = 50000
    source.close()

    const target = database('dch-restorable-raw-dst-')
    const result = importHistory(target.db, document)
    expect(result.imported.episode_saved_resources).toBe(1)
    expect(target.db.prepare(
      'SELECT episode_id, resource_id, change_count FROM episode_saved_resources',
    ).all()).toEqual([{ episode_id: 'ep1', resource_id: 1, change_count: 1 }])
    expect(target.db.prepare(
      'SELECT COUNT(*) AS n FROM episode_verification_results',
    ).get()).toEqual({ n: 0 })
    target.close()
  })

  it('reconstructs a historical test-success fact from an imported raw test observation', () => {
    const source = database('dch-restorable-test-src-')
    seed(source.db)
    source.db.prepare(
      "UPDATE observations SET activity_event='verify-test-success' WHERE id=1",
    ).run()
    source.db.prepare(
      'INSERT INTO episode_verification_results(episode_id, activity_event, first_observed_at_ms, last_observed_at_ms, observation_count) VALUES (?, ?, ?, ?, ?)',
    ).run('ep1', 'verify-test-success', 1, 1, 1)
    const document = structuredClone(exportHistory(source.db, 5000)) as unknown as {
      tables: Record<string, Array<Record<string, unknown>>>
    }
    document.tables.episode_verification_results![0]!.observation_count = 12_345
    source.close()
    const target = database('dch-restorable-test-dst-')
    const result = importHistory(target.db, document)
    expect(result.imported.episode_verification_results).toBe(1)
    expect(target.db.prepare(
      'SELECT activity_event, observation_count FROM episode_verification_results',
    ).all()).toEqual([
      { activity_event: 'verify-test-success', observation_count: 1 },
    ])
    target.close()
  })

  it('does not import forged verification aggregates without corresponding raw test events', () => {
    const source = database('dch-forged-verification-src-')
    seed(source.db)
    const document = structuredClone(exportHistory(source.db, 5000)) as unknown as {
      tables: Record<string, Array<Record<string, unknown>>>
    }
    document.tables.episode_verification_results = [{
      episode_id: 'ep1',
      activity_event: 'verify-test-success',
      first_observed_at_ms: 1,
      last_observed_at_ms: 1,
      observation_count: 99,
    }]
    source.close()

    const target = database('dch-forged-verification-dst-')
    const result = importHistory(target.db, document)
    expect(result.imported.episode_verification_results).toBe(0)
    expect(target.db.prepare(
      'SELECT COUNT(*) AS n FROM episode_verification_results',
    ).get()).toEqual({ n: 0 })
    target.close()
  })

  it('exports Episode-retained event facts for audit but never trusts unproven imported aggregates', () => {
    const source = database('dch-audit-compacted-src-')
    seed(source.db)
    source.db.prepare(
      'INSERT INTO episode_saved_resources(episode_id, resource_id, first_changed_at_ms, last_changed_at_ms, change_count) VALUES (?, ?, ?, ?, ?)',
    ).run('ep1', 1, 1, 1, 1)
    source.db.prepare(
      'INSERT INTO episode_verification_results(episode_id, activity_event, first_observed_at_ms, last_observed_at_ms, observation_count) VALUES (?, ?, ?, ?, ?)',
    ).run('ep1', 'verify-test-success', 1, 1, 1)
    // Simulate the shorter raw TTL. Export retains the bounded aggregate,
    // but a user-provided backup alone does not prove an observation occurred.
    source.db.prepare('DELETE FROM observations').run()
    const document = exportHistory(source.db, 5000)
    expect(document.tables.episode_saved_resources).toHaveLength(1)
    expect(document.tables.episode_verification_results).toHaveLength(1)
    source.close()

    const target = database('dch-audit-compacted-dst-')
    const result = importHistory(target.db, document)
    expect(result.imported.episode_saved_resources).toBe(0)
    expect(result.imported.episode_verification_results).toBe(0)
    expect(target.db.prepare('SELECT COUNT(*) AS n FROM episode_saved_resources').get())
      .toEqual({ n: 0 })
    expect(target.db.prepare('SELECT COUNT(*) AS n FROM episode_verification_results').get())
      .toEqual({ n: 0 })
    target.close()
  })

  it('never carries the pairing digest', () => {
    const source = database('dsh-ch-export-cred-')
    seed(source.db)
    const serialised = JSON.stringify(exportHistory(source.db, 5_000))
    expect(serialised).not.toContain('deadbeef-browser')
    expect(serialised).not.toContain('deadbeef-editor')
    expect(serialised).not.toContain('companion_pairing')
    source.close()
  })

  it('refuses a document it cannot store verbatim', () => {
    const db = database('dsh-ch-export-bad-').db
    const good = exportHistory(db, 1)

    expect(() => importHistory(db, { ...good, schema: 'someone-elses/v9' }))
      .toThrow(HistoryImportError)
    expect(() => importHistory(db, {
      ...good,
      schemaVersion: undefined,
    })).toThrow(/unsupported schema version/)
    expect(() => importHistory(db, {
      ...good,
      schemaVersion: good.schemaVersion + 1,
    })).toThrow(/unsupported schema version/)
    expect(() => importHistory(db, {
      ...good,
      tables: { ...good.tables, surprise_table: [] },
    })).toThrow(/unknown table: surprise_table/)
    expect(() => importHistory(db, {
      ...good,
      tables: { ...good.tables, episodes: [{ id: 'x', not_a_column: 1 }] },
    })).toThrow(/unknown column: not_a_column/)
    expect(() => importHistory(db, {
      ...good,
      tables: { ...good.tables, episodes: [{ id: 'x', summary_text: { nested: true } }] },
    })).toThrow(/not a primitive value/)
    expect(() => importHistory(db, { schema: 'dsh-computer-history/v1', schemaVersion: 1 }))
      .toThrow(/no tables/)
  })
})
