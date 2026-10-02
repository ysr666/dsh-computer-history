import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PolicyRuleId,
  type NativeObservation,
  type PolicySnapshot,
} from '../../src/shared/index.js'
import { IngestionService } from '../../src/host/ingestion/index.js'
import { EpisodeStore, openHistoryDatabase } from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A real file in a real directory. The ingestion path canonicalises a file
 * resource with `realpath` and fails closed when an existing prefix is a
 * symlink — on macOS both `/tmp` and `/var` are — so a fixture pointing at a
 * path that does not exist is refused, which is a fact about the fixture and
 * not about the code under test.
 */
function realFile(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-rebuild-'))
  roots.push(root)
  mkdirSync(path.join(root, 'src'), { recursive: true })
  const file = path.join(root, 'src', 'report.md')
  writeFileSync(file, '# report\n')
  return file
}

describe('a rebuild must not disturb episodes it does not own', () => {
  it('keeps another episode citations and surfaces through reseed and ingest', async () => {
    const file = realFile()
    const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-rebuild-db-'))
    roots.push(root)
    const history = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'),
      nowMs: 1,
    })
    const db = history.db
    const now = Date.now()

    db.prepare(`INSERT INTO resources(id, kind, canonical_uri, display_label, first_seen_at_ms, last_seen_at_ms)
      VALUES (1, 'file', ?, 'report.md', ?, ?)`).run(`file://${file}`, now - 60_000, now)
    for (const id of [1, 2]) {
      db.prepare(`INSERT INTO observations(id, collector_session, collector_seq, observed_at_ms, pid, bundle_id, surface_kind, resource_id,
        workspace_source, workspace_confidence, privacy_secure, privacy_protected, source_provider, source_adapter, policy_revision, expires_at_ms)
        VALUES (?, 'foreign', ?, ?, 1, 'com.example.Other', 'editor', 1, 'none', 0, 0, 0, 'macos-ax', 'vscode', 1, ?)`)
        .run(id, id, now - 60_000 + id * 1000, now + 86_400_000)
    }
    db.prepare(`INSERT INTO episodes(id, started_at_ms, ended_at_ms, start_reason, end_reason, summary_kind, summary_text, confidence, state, created_at_ms, updated_at_ms)
      VALUES ('foreign-episode', ?, ?, 'first-observation', 'idle', 'deterministic', 'Not mine.', 0.8, 'closed', ?, ?)`)
      .run(now - 60_000, now - 30_000, now, now)
    db.prepare(`INSERT INTO episode_observations(episode_id, observation_id) VALUES ('foreign-episode', 1), ('foreign-episode', 2)`).run()
    db.prepare(`INSERT INTO episode_surfaces(episode_id, bundle_id, surface_kind, first_seen_at_ms, last_seen_at_ms, observation_count)
      VALUES ('foreign-episode', 'com.example.Other', 'editor', ?, ?, 2)`).run(now - 60_000, now - 30_000)
    db.prepare(`INSERT INTO episode_summary_citations(episode_id, observation_id) VALUES ('foreign-episode', 1), ('foreign-episode', 2)`).run()

    const policy: PolicySnapshot = {
      revision: 1,
      mode: 'include-only',
      updatedAtMs: 1,
      rules: [{
        id: PolicyRuleId('allow-vscode'),
        dimension: 'app',
        action: 'allow',
        matcher: 'exact',
        pattern: 'com.microsoft.VSCode',
        builtIn: false,
        createdAtMs: 1,
        updatedAtMs: 1,
      }],
    }
    const ingestion = new IngestionService(
      db,
      { resolve: async () => ({ source: 'none' as const, confidence: 0 }) },
      () => policy,
      () => now,
    )
    const message: NativeObservation = {
      v: 1,
      type: 'observation',
      collectorSession: 'live',
      seq: 1,
      observedAtMs: now,
      app: { pid: 9, bundleId: 'com.microsoft.VSCode' },
      window: { title: 'report.md', document: file },
      privacy: { secure: false, protected: false },
      source: { adapter: 'vscode' },
    }

    expect(await ingestion.ingest(message)).toBe(true)
    ingestion.reseed()

    const foreign = new EpisodeStore(db).get('foreign-episode' as never)
    expect(foreign?.summaryObservationIds).toEqual([1, 2])
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM episode_surfaces WHERE episode_id = ?')
        .get('foreign-episode'),
    ).toEqual({ n: 1 })
    history.close()
  })
})
