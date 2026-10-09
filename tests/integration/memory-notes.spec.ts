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
  return { history, db, notes, addEpisode, save }
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

  it('rejects forget outside the history deletion transaction', () => {
    const { history, notes } = fixture()
    expect(() => notes.forget({ kind: 'all' })).toThrow(/transaction/)
    history.close()
  })
})
