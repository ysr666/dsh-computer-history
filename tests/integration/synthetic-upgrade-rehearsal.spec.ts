import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { EpisodeStore, openHistoryDatabase } from '../../src/host/store/index.js'

/** All source files are generated synthetic QA data; never touch an existing user profile. */
const NOW = 1_800_000_000_000
const roots: string[] = []
const count = (db: DatabaseSync, table: string) =>
  Number((db.prepare('SELECT COUNT(*) AS n FROM ' + table).get() as { n: number }).n)

function createV15(root: string) {
  const history = openHistoryDatabase({ dataDirectory: path.join(root, 'v15'), nowMs: NOW })
  const db = history.db
  // v15 reconstruction occurs only inside a throwaway, freshly created database.
  db.exec('DROP TABLE episode_saved_resources; DROP TABLE episode_verification_results')
  db.prepare('DELETE FROM schema_migrations WHERE version = 16').run()
  db.exec('PRAGMA user_version = 15')
  const items = [
    { id: 'qa-cad', n: 1, event: 'save', uri: 'file:///synthetic/model.step' },
    { id: 'qa-test', n: 2, event: 'verify-test-success', uri: 'file:///synthetic/tests.log' },
    { id: 'qa-expired', n: 3, event: 'save', uri: 'file:///synthetic/expired.step' },
  ]
  for (const { id, n, event, uri } of items) {
    db.prepare('INSERT INTO resources(id,kind,canonical_uri,display_label,first_seen_at_ms,last_seen_at_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .run(n, 'file', uri, uri.split('/').at(-1)!, NOW - 1_000 + n, NOW - 1_000 + n)
    db.prepare('INSERT INTO observations(id,collector_session,collector_seq,observed_at_ms,pid,bundle_id,surface_kind,resource_id,workspace_source,workspace_confidence,privacy_secure,privacy_protected,source_provider,source_adapter,policy_revision,expires_at_ms,activity_event) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(n, 'synthetic-only', n, NOW - 1_000 + n, 8, 'org.synthetic.app', 'editor',
        n, 'dsh', 1, 0, 0, 'macos-ax', 'vscode', 1, NOW + 10_000, event)
    db.prepare('INSERT INTO episodes(id,started_at_ms,ended_at_ms,start_reason,end_reason,summary_kind,summary_text,confidence,state,created_at_ms,updated_at_ms,expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, NOW - 1_000 + n, NOW - 1_000 + n, 'first-observation',
        'timeout', 'deterministic', 'Synthetic QA history', 1, 'closed',
        NOW - 1_000 + n, NOW - 1_000 + n, NOW + 10_000)
    db.prepare('INSERT INTO episode_observations(episode_id,observation_id) VALUES (?, ?)')
      .run(id, n)
  }
  // There is an Episode, but raw evidence for its save was already purged.
  db.prepare('DELETE FROM observations WHERE id = 3').run()
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 15 })
  expect(count(db, 'observations')).toBe(2)
  return history
}

function newSyntheticRoot() {
  const r = mkdtempSync(path.join(os.tmpdir(), 'dch-v15-v16-synthetic-'))
  roots.push(r)
  return r
}

function restore(snapshot: string, directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const filename = path.join(directory, 'history.sqlite')
  copyFileSync(snapshot, filename)
  chmodSync(filename, 0o600)
  return filename
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('v15 to v16 online backup, upgrade and restore rehearsal (synthetic)', () => {
  it('preserves uncheckpointed WAL evidence in a private SQLite backup, upgrading a copy only', async () => {
    const r = newSyntheticRoot()
    const original = createV15(r)
    try {
      expect(original.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(statSync(original.databasePath + '-wal').size).toBeGreaterThan(0)
      const backupPath = path.join(r, 'snapshot-v15.sqlite')
      await backup(original.db, backupPath)
      chmodSync(backupPath, 0o600)
      expect(statSync(backupPath).mode & 0o777).toBe(0o600)
      // Subsequent writes to the source must not alter this earlier consistent snapshot.
      original.db.prepare('DELETE FROM observations WHERE id = 2').run()
      const restored = openHistoryDatabase({
        dataDirectory: path.dirname(restore(backupPath, path.join(r, 'upgrade'))),
        nowMs: NOW,
      })
      try {
        expect(restored.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 16 })
        expect(restored.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
        expect(restored.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        expect(count(restored.db, 'observations')).toBe(2)
        expect(count(restored.db, 'episode_saved_resources')).toBe(1)
        expect(count(restored.db, 'episode_verification_results')).toBe(1)
        const episodes = new EpisodeStore(restored.db)
        expect(episodes.queryEvidence({ eventKind: 'save' }, NOW).items.map(item => String(item.id)))
          .toEqual(['qa-cad'])
        expect(episodes.queryEvidence({ eventKind: 'test' }, NOW).items.map(item => String(item.id)))
          .toEqual(['qa-test'])
        expect(episodes.queryEvidence({ eventKind: 'save', text: 'expired.step' }, NOW).items)
          .toEqual([])
      } finally { restored.close() }
      expect(original.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 15 })
    } finally { original.close() }
  })

  it('rejects a mismatched schema checksum; recovers by restoring the unchanged backup', async () => {
    const r = newSyntheticRoot()
    const source = createV15(r)
    const backupPath = path.join(r, 'known-good-v15.sqlite')
    try {
      await backup(source.db, backupPath)
      chmodSync(backupPath, 0o600)
    } finally { source.close() }
    const location = path.join(r, 'restore')
    const filename = restore(backupPath, location)
    const damaged = new DatabaseSync(filename)
    try {
      damaged.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 15')
        .run('tampered-checksum')
    } finally { damaged.close() }
    expect(() => openHistoryDatabase({ dataDirectory: location, nowMs: NOW }))
      .toThrow(/migration checksum mismatch/)
    // Never attempt an in-place schema downgrade; return to a consistent backup.
    restore(backupPath, location)
    const rescued = openHistoryDatabase({ dataDirectory: location, nowMs: NOW })
    try {
      expect(rescued.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 16 })
      expect(rescued.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(rescued.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(count(rescued.db, 'episode_saved_resources')).toBe(1)
      expect(count(rescued.db, 'episode_verification_results')).toBe(1)
    } finally { rescued.close() }
  })

  it('atomically rolls back a partially executing v16 migration, then permits clean retry', () => {
    const r = newSyntheticRoot()
    const source = createV15(r)
    const dataDirectory = path.join(r, 'v15')
    // Simulate a pre-existing conflicting schema object, which would make
    // migration 0016 fail AFTER its first CREATE TABLE statement.
    source.db.exec('CREATE TABLE episode_verification_results (wrong_schema INTEGER)')
    source.close()

    expect(() => openHistoryDatabase({ dataDirectory, nowMs: NOW }))
      .toThrow(/already exists/)

    const inspect = new DatabaseSync(path.join(dataDirectory, 'history.sqlite'))
    try {
      // BEGIN IMMEDIATE ensures ALL v16 changes are rolled back together,
      // not just the statement that failed.
      expect(inspect.prepare('PRAGMA user_version').get())
        .toEqual({ user_version: 15 })
      expect(inspect.prepare(
        'SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 16',
      ).get()).toEqual({ n: 0 })
      expect(inspect.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'episode_saved_resources'",
      ).all()).toEqual([])
      expect(inspect.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'episode_verification_results'",
      ).all()).toEqual([{ name: 'episode_verification_results' }])
      expect(count(inspect, 'observations')).toBe(2)
      expect(inspect.prepare('PRAGMA integrity_check').get())
        .toEqual({ integrity_check: 'ok' })
      // Repair only the disposable deliberately conflicting table.
      inspect.exec('DROP TABLE episode_verification_results')
    } finally { inspect.close() }

    const retried = openHistoryDatabase({ dataDirectory, nowMs: NOW })
    try {
      expect(retried.db.prepare('PRAGMA user_version').get())
        .toEqual({ user_version: 16 })
      expect(retried.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(count(retried.db, 'episode_saved_resources')).toBe(1)
      expect(count(retried.db, 'episode_verification_results')).toBe(1)
    } finally { retried.close() }
  })

})
