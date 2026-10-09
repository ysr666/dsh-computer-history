import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EpisodeStore, MemoryNoteStore, openHistoryDatabase,
} from '../../src/host/store/index.js'
import { DeletionService, RetentionService } from '../../src/host/retention/index.js'
import { exportHistory, importHistory } from '../../src/host/audit/export.js'

const dirs: string[] = []
const NOW = 1000

function fixture() {
  const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dch-persistent-note-'))
  dirs.push(dataDirectory)
  const history = openHistoryDatabase({ dataDirectory, nowMs: NOW })
  const db = history.db
  function addEpisode(id: string, app: string, thread = 'workspace:alpha') {
    db.prepare(`
      INSERT INTO episodes(
        id, started_at_ms, ended_at_ms, start_reason, end_reason,
        thread_key, primary_workspace_title, summary_kind, summary_text,
        confidence, state, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, 100, 200, 'first-observation', 'timeout',
      thread, 'Alpha', 'deterministic', 'Activity',
      1, 'closed', 200, 200, 20000,
    )
    db.prepare(`
      INSERT INTO episode_surfaces(
        episode_id, bundle_id, surface_kind, first_seen_at_ms,
        last_seen_at_ms, observation_count
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, app, 'editor', 100, 200, 1)
    return new EpisodeStore(db).get(id as never)!
  }
  const notes = new MemoryNoteStore(db)
  function save(id = 'episode-1', app = 'editor.alpha') {
    const anchor = addEpisode(id, app)
    return notes.save({
      threadKey: anchor.threadKey!,
      projectLabel: 'Alpha',
      text: 'User-entered project reminder',
      anchor,
    }, NOW)
  }
  return { history, db, dataDirectory, notes, addEpisode, save }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('M2 confirmed persistent notes', () => {
  it('migrates to schema 14 and never creates a note without a user write', () => {
    const { history, db, notes } = fixture()
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 14 })
    expect(notes.list()).toEqual([])
    history.close()
  })

  it('saves only user-authored text with explicit provenance and app metadata', () => {
    const { history, db, notes, save } = fixture()
    const note = save()
    expect(note.text).toBe('User-entered project reminder')
    expect(note.evidenceLevel).toBe('user-confirmed')
    expect(notes.list(note.projectId)).toEqual([note])
    expect(db.prepare('SELECT bundle_id FROM memory_note_apps').all())
      .toEqual([{ bundle_id: 'editor.alpha' }])
    expect(db.prepare('SELECT thread_key FROM memory_projects').get())
      .toEqual({ thread_key: 'workspace:alpha' })
    history.close()
  })

  it('refuses empty or oversized notes and fictitious/expired source episodes', () => {
    const { history, notes, addEpisode } = fixture()
    const anchor = addEpisode('anchor', 'editor.alpha')
    const payload = { threadKey: anchor.threadKey!, projectLabel: 'Alpha', anchor }
    expect(() => notes.save({ ...payload, text: ' ' }, NOW)).toThrow(/1..1000/)
    expect(() => notes.save({ ...payload, text: 'a'.repeat(1001) }, NOW)).toThrow(/1..1000/)
    expect(() => notes.save({ ...payload, text: 'x' }, 25000)).toThrow(/not currently retained/)
    expect(() => notes.save({
      ...payload, anchor: { ...anchor, id: 'forged' as never }, text: 'x',
    }, NOW)).toThrow(/not currently retained/)
    expect(notes.list()).toEqual([])
    history.close()
  })

  it('supports revision and removal and cleans empty project shells', () => {
    const { history, db, notes, save } = fixture()
    const note = save()
    expect(notes.update(note.id, 'Revised by me', NOW + 1)).toBe(true)
    expect(notes.list()[0]?.text).toBe('Revised by me')
    expect(notes.remove(note.id)).toBe(true)
    expect(notes.list()).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_projects').get())
      .toEqual({ count: 0 })
    history.close()
  })

  it('preserves user-confirmed notes through raw and Episode TTL sweeps', () => {
    const { history, notes, save } = fixture()
    const note = save()
    new RetentionService(history.db).sweep(25000)
    expect(new EpisodeStore(history.db).get('episode-1' as never)).toBeUndefined()
    expect(notes.list()).toEqual([note])
    history.close()
  })

  it('deletes confirmed notes atomically on targeted app forget after episode TTL', () => {
    const { history, notes, save } = fixture()
    save()
    new RetentionService(history.db).sweep(25000)
    const result = new DeletionService(history.db).delete(
      { scope: { kind: 'app', bundleId: 'editor.alpha' } },
      30000,
    )
    expect(result.observationsDeleted).toBe(0)
    expect(notes.list()).toEqual([])
    history.close()
  })

  it('does not remove unrelated app notes when forgetting a different app', () => {
    const { history, notes, save } = fixture()
    save()
    new DeletionService(history.db).delete(
      { scope: { kind: 'app', bundleId: 'editor.other' } },
      NOW + 1,
    )
    expect(notes.list()).toHaveLength(1)
    history.close()
  })

  it('handles episode, time-range, and all-history Forget conservatively', () => {
    for (const scope of [
      { kind: 'episode' as const, episodeId: 'episode-1' as never },
      { kind: 'time-range' as const, startMs: 100, endMs: 201 },
      { kind: 'all' as const },
    ]) {
      const { history, notes, save } = fixture()
      save()
      new DeletionService(history.db).delete({ scope }, NOW + 1)
      expect(notes.list()).toEqual([])
      history.close()
    }
  })

  it('exports user-confirmed notes for audit but does not silently restore them', () => {
    const source = fixture()
    source.save()
    const document = exportHistory(source.db, NOW + 1)
    expect(document.tables.memory_projects).toHaveLength(1)
    expect(document.tables.memory_user_notes).toHaveLength(1)
    expect(document.tables.memory_note_apps).toHaveLength(1)

    const target = fixture()
    const imported = importHistory(target.db, document)
    expect(imported.imported.memory_projects).toBe(0)
    expect(imported.imported.memory_user_notes).toBe(0)
    expect(imported.imported.memory_note_apps).toBe(0)
    expect(target.notes.list()).toEqual([])
    source.history.close()
    target.history.close()
  })

  it('restores an exported long-term note only after explicit approval', () => {
    const source = fixture()
    const note = source.save()
    const document = exportHistory(source.db, 10_000)
    const target = fixture()
    expect(() => target.notes.restoreExport(document, false)).toThrow(/confirmation/)
    expect(target.notes.list()).toEqual([])
    expect(target.notes.restoreExport(document, true)).toEqual({
      restored: 1, skipped: 0,
    })
    expect(target.notes.list()).toEqual([note])
    expect(target.db.prepare('SELECT bundle_id FROM memory_note_apps').all())
      .toEqual([{ bundle_id: 'editor.alpha' }])
    expect(target.notes.restoreExport(document, true)).toEqual({
      restored: 0, skipped: 1,
    })
    source.history.close()
    target.history.close()
  })

  it('rejects malformed, conflicting or orphaned backup rows transactionally', () => {
    const source = fixture()
    source.save()
    const document = exportHistory(source.db, 10_000)
    const target = fixture()
    const original = document.tables.memory_user_notes![0]!
    const conflict = {
      ...document,
      tables: {
        ...document.tables,
        memory_user_notes: [{ ...original, note_text: 'different' }],
      },
    }
    expect(() => target.notes.restoreExport({
      ...document, tables: {
        ...document.tables,
        memory_projects: [{ ...document.tables.memory_projects![0], id: 'fake' }],
      },
    }, true)).toThrow(/project identity/)
    expect(target.notes.list()).toEqual([])
    target.notes.restoreExport(document, true)
    expect(() => target.notes.restoreExport(conflict, true)).toThrow(/conflict/)
    expect(target.notes.list()[0]?.text).toBe(source.notes.list()[0]?.text)
    expect(() => target.notes.restoreExport({
      ...document, tables: {
        ...document.tables, memory_note_apps: [{ note_id: 'orphan', bundle_id: 'x' }],
      },
    }, true)).toThrow(/application reference/)
    expect(target.notes.list()).toHaveLength(1)
    source.history.close()
    target.history.close()
  })

  it('refuses stale source selection after another Host deletes the Episode', () => {
    const first = fixture()
    const anchor = first.addEpisode('stale', 'editor.alpha')
    const second = openHistoryDatabase({
      dataDirectory: first.dataDirectory, nowMs: NOW,
    })
    new EpisodeStore(second.db).delete(anchor.id)
    expect(() => first.notes.save({
      threadKey: 'workspace:alpha', projectLabel: 'Alpha',
      text: 'must not become permanent', anchor,
    }, NOW)).toThrow(/not currently retained/)
    expect(first.notes.list()).toEqual([])
    second.close()
    first.history.close()
  })

  it('sees a second Host full Forget on the original connection', () => {
    const first = fixture()
    first.save()
    const second = openHistoryDatabase({
      dataDirectory: first.dataDirectory, nowMs: NOW,
    })
    new DeletionService(second.db).delete({ scope: { kind: 'all' } }, NOW + 1)
    expect(first.notes.list()).toEqual([])
    second.close()
    first.history.close()
  })

  it('rolls back note revocation if the surrounding Forget transaction fails', () => {
    const { history, db, notes, save } = fixture()
    const note = save()
    db.exec(`
      CREATE TRIGGER force_forget_failure
      BEFORE INSERT ON deletion_log BEGIN
        SELECT RAISE(ABORT, 'injected forget failure');
      END
    `)
    expect(() => new DeletionService(db).delete({
      scope: { kind: 'all' },
    }, NOW + 1)).toThrow(/injected forget failure/)
    expect(notes.list()).toEqual([note])
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_projects').get())
      .toEqual({ count: 1 })
    history.close()
  })

  it('rejects forget outside the history deletion transaction', () => {
    const { history, notes } = fixture()
    expect(() => notes.forget({ kind: 'all' })).toThrow(/transaction/)
    history.close()
  })
})
