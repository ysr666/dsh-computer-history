import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { HISTORY_EXPORT_SCHEMA, type EpisodeSummary, type UserMemoryNote } from '../../shared/index.js'
import { memoryIdForThreadKey } from '../memory/index.js'

export interface SaveUserMemoryNote {
  readonly threadKey: string
  readonly projectLabel: string
  readonly text: string
  /** A real, currently retained source used solely to scope future Forget. */
  readonly anchor: EpisodeSummary
}

function normaliseText(value: string): string {
  if (typeof value !== 'string') throw new Error('memory note must be text')
  const text = value.trim()
  if (!text || text.length > 1000) {
    throw new Error('memory note must contain 1..1000 characters')
  }
  return text
}

function backupObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid note backup row')
  }
  return value as Record<string, unknown>
}

function backupString(value: unknown, max = 1_000): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new Error('invalid note backup text')
  }
  return value
}

function backupTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('invalid note backup timestamp')
  }
  return value
}

function materialize(row: {
  readonly id: string
  readonly project_id: string
  readonly label: string
  readonly note_text: string
  readonly created_at_ms: number
  readonly updated_at_ms: number
}): UserMemoryNote {
  return {
    id: row.id,
    projectId: row.project_id,
    projectLabel: row.label,
    text: row.note_text,
    evidenceLevel: 'user-confirmed',
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  }
}

export type NoteForgetScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'episode'; readonly episodeId: string }
  | { readonly kind: 'app'; readonly bundleId: string }
  | { readonly kind: 'time-range'; readonly startMs: number; readonly endMs: number }

export class MemoryNoteStore {
  public constructor(private readonly db: DatabaseSync) {}

  /** Deliberately commits the user's confirmation as one atomic write. */
  public save(input: SaveUserMemoryNote, nowMs = Date.now()): UserMemoryNote {
    const text = normaliseText(input.text)
    const label = input.projectLabel.trim().slice(0, 256)
    const key = input.threadKey.trim()
    if (!key || !label || input.anchor.threadKey !== key
      || input.anchor.state === 'invalidated') {
      throw new Error('cannot confirm a note without a matching retained project')
    }
    if (this.db.isTransaction) throw new Error('memory note writer requires transaction ownership')
    const id = randomUUID()
    const projectId = memoryIdForThreadKey(key)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      // The service may have projected the Episode earlier, but a concurrent
      // Forget or TTL sweep can invalidate it. Re-check under the writer lock.
      const anchor = this.db.prepare(`
        SELECT thread_key, started_at_ms, ended_at_ms, state, expires_at_ms
        FROM episodes WHERE id = ?
      `).get(String(input.anchor.id)) as {
        thread_key: string | null
        started_at_ms: number
        ended_at_ms: number
        state: string
        expires_at_ms: number | null
      } | undefined
      if (!anchor || anchor.thread_key !== key
        || anchor.state === 'invalidated'
        || (anchor.expires_at_ms !== null && anchor.expires_at_ms <= nowMs)
        || anchor.started_at_ms !== input.anchor.startedAtMs
        || anchor.ended_at_ms !== input.anchor.endedAtMs) {
        throw new Error('the selected source episode is not currently retained')
      }
      this.db.prepare(`
        INSERT INTO memory_projects(id, thread_key, label, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          updated_at_ms = excluded.updated_at_ms
      `).run(projectId, key, label, nowMs, nowMs)
      this.db.prepare(`
        INSERT INTO memory_user_notes(
          id, project_id, note_text, anchor_episode_id,
          anchor_started_at_ms, anchor_ended_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, projectId, text, String(input.anchor.id),
        input.anchor.startedAtMs, input.anchor.endedAtMs, nowMs, nowMs,
      )
      const appIds = this.db.prepare(`
        SELECT DISTINCT bundle_id FROM episode_surfaces WHERE episode_id = ?
      `).all(String(input.anchor.id)) as Array<{ bundle_id: string }>
      for (const { bundle_id: bundleId } of appIds) {
        this.db.prepare(
          'INSERT INTO memory_note_apps(note_id, bundle_id) VALUES (?, ?)',
        ).run(id, bundleId)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      throw error
    }
    return {
      id, projectId, projectLabel: label, text,
      evidenceLevel: 'user-confirmed',
      createdAtMs: nowMs, updatedAtMs: nowMs,
    }
  }

  public list(projectId?: string, limit = 1_000): readonly UserMemoryNote[] {
    const bounded = Math.max(1, Math.min(1_000, Math.trunc(limit)))
    return (this.db.prepare(`
      SELECT n.id, n.project_id, p.label, n.note_text,
             n.created_at_ms, n.updated_at_ms
      FROM memory_user_notes n
      JOIN memory_projects p ON p.id = n.project_id
      WHERE (? IS NULL OR n.project_id = ?)
      ORDER BY n.created_at_ms DESC, n.id
      LIMIT ?
    `).all(projectId ?? null, projectId ?? null, bounded) as Array<{
      id: string; project_id: string; label: string; note_text: string;
      created_at_ms: number; updated_at_ms: number
    }>).map(materialize)
  }

  public update(id: string, textInput: string, nowMs = Date.now()): boolean {
    const noteText = normaliseText(textInput)
    return this.db.prepare(`
      UPDATE memory_user_notes
      SET note_text = ?, updated_at_ms = ?
      WHERE id = ?
    `).run(noteText, nowMs, id).changes > 0
  }

  public remove(id: string): boolean {
    if (this.db.isTransaction) throw new Error('memory note removal requires transaction ownership')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const deleted = this.db.prepare('DELETE FROM memory_user_notes WHERE id = ?')
        .run(id).changes > 0
      this.deleteOrphanProjects()
      this.db.exec('COMMIT')
      return deleted
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Called INSIDE DeletionService's own outer transaction, before deleting
   * Episode evidence. TTL cleanup deliberately never calls this method.
   */
  public forget(scope: NoteForgetScope): number {
    if (!this.db.isTransaction) {
      throw new Error('memory note forget must share the history deletion transaction')
    }
    if (scope.kind === 'all') {
      const deleted = this.db.prepare('DELETE FROM memory_user_notes').run().changes
      this.deleteOrphanProjects()
      return Number(deleted)
    }
    let deleted: number
    if (scope.kind === 'episode') {
      deleted = Number(this.db.prepare(
        'DELETE FROM memory_user_notes WHERE anchor_episode_id = ?',
      ).run(scope.episodeId).changes)
    } else if (scope.kind === 'time-range') {
      deleted = Number(this.db.prepare(`
        DELETE FROM memory_user_notes
        WHERE anchor_started_at_ms < ? AND anchor_ended_at_ms >= ?
      `).run(scope.endMs, scope.startMs).changes)
    } else {
      deleted = Number(this.db.prepare(`
        DELETE FROM memory_user_notes
        WHERE id IN (
          SELECT note_id FROM memory_note_apps WHERE bundle_id = ?
        )
      `).run(scope.bundleId).changes)
    }
    this.deleteOrphanProjects()
    return deleted
  }

  /**
   * Explicit import of an exported note set, NEVER invoked by ordinary history
   * import. Caller must have obtained direct user confirmation for retention.
   * All rows are validated before acquiring the writer transaction.
   */
  public restoreExport(
    document: unknown,
    userConfirmedRetention: boolean,
  ): { readonly restored: number; readonly skipped: number } {
    if (userConfirmedRetention !== true) {
      throw new Error('explicit long-term restore confirmation required')
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new Error('invalid note backup')
    }
    const root = document as Record<string, unknown>
    if (root.schema !== HISTORY_EXPORT_SCHEMA
      || !Number.isSafeInteger(root.schemaVersion)
      || (root.schemaVersion as number) < 14) {
      throw new Error('unsupported note backup version')
    }
    const tables = root.tables
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
      throw new Error('missing note backup tables')
    }
    const data = tables as Record<string, unknown>
    const p = data.memory_projects
    const n = data.memory_user_notes
    const a = data.memory_note_apps
    if (!Array.isArray(p) || !Array.isArray(n) || !Array.isArray(a)
      || p.length > 500 || n.length > 1_000 || a.length > 5_000) {
      throw new Error('missing or oversized note backup')
    }
    const projects = new Map<string, { key: string; label: string }>()
    for (const item of p) {
      const row = backupObject(item)
      const id = backupString(row.id, 67)
      const key = backupString(row.thread_key, 2_048)
      const label = backupString(row.label, 256)
      if (!/^pm_[0-9a-f]{64}$/.test(id)
        || memoryIdForThreadKey(key) !== id || projects.has(id)) {
        throw new Error('invalid or duplicate project identity')
      }
      projects.set(id, { key, label })
    }
    const notes = new Map<string, {
      projectId: string; text: string; episodeId: string;
      started: number; ended: number; created: number; updated: number;
    }>()
    for (const item of n) {
      const row = backupObject(item)
      const id = backupString(row.id, 36)
      const projectId = backupString(row.project_id, 67)
      const text = backupString(row.note_text).trim()
      const episodeId = backupString(row.anchor_episode_id)
      const started = backupTimestamp(row.anchor_started_at_ms)
      const ended = backupTimestamp(row.anchor_ended_at_ms)
      const created = backupTimestamp(row.created_at_ms)
      const updated = backupTimestamp(row.updated_at_ms)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
        || !projects.has(projectId)
        || text.length < 1 || text.length > 1000
        || ended < started || updated < created || notes.has(id)) {
        throw new Error('invalid or duplicate note identity')
      }
      notes.set(id, {
        projectId, text, episodeId, started, ended, created, updated,
      })
    }
    const apps: Array<{ id: string; bundleId: string }> = []
    const pairs = new Set<string>()
    for (const item of a) {
      const row = backupObject(item)
      const id = backupString(row.note_id, 36)
      const bundleId = backupString(row.bundle_id, 256)
      const pair = id + '\u0000' + bundleId
      if (!notes.has(id) || pairs.has(pair)) {
        throw new Error('invalid note application reference')
      }
      pairs.add(pair)
      apps.push({ id, bundleId })
    }
    if (this.db.isTransaction) throw new Error('note restore requires transaction ownership')
    let restored = 0
    let skipped = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const [projectId, project] of projects) {
        if (![...notes.values()].some(note => note.projectId === projectId)) continue
        const existing = this.db.prepare(
          'SELECT thread_key FROM memory_projects WHERE id = ?',
        ).get(projectId) as { thread_key: string } | undefined
        if (existing && existing.thread_key !== project.key) {
          throw new Error('existing project identity conflict')
        }
        this.db.prepare(`
          INSERT OR IGNORE INTO memory_projects(
            id, thread_key, label, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, 0, 0)
        `).run(projectId, project.key, project.label)
      }
      for (const [id, note] of notes) {
        const existing = this.db.prepare(`
          SELECT project_id, note_text, anchor_episode_id,
            anchor_started_at_ms, anchor_ended_at_ms
          FROM memory_user_notes WHERE id = ?
        `).get(id) as {
          project_id: string; note_text: string; anchor_episode_id: string;
          anchor_started_at_ms: number; anchor_ended_at_ms: number;
        } | undefined
        if (existing) {
          if (existing.project_id !== note.projectId
            || existing.note_text !== note.text
            || existing.anchor_episode_id !== note.episodeId
            || existing.anchor_started_at_ms !== note.started
            || existing.anchor_ended_at_ms !== note.ended) {
            throw new Error('existing note identity conflict')
          }
          skipped += 1
          continue
        }
        this.db.prepare(`
          INSERT INTO memory_user_notes(
            id, project_id, note_text, anchor_episode_id,
            anchor_started_at_ms, anchor_ended_at_ms,
            created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, note.projectId, note.text, note.episodeId,
          note.started, note.ended, note.created, note.updated)
        restored += 1
      }
      for (const app of apps) {
        this.db.prepare(
          'INSERT OR IGNORE INTO memory_note_apps(note_id,bundle_id) VALUES (?,?)',
        ).run(app.id, app.bundleId)
      }
      this.db.exec('COMMIT')
      return { restored, skipped }
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  private deleteOrphanProjects(): void {
    this.db.exec(`
      DELETE FROM memory_projects
      WHERE NOT EXISTS (
        SELECT 1 FROM memory_user_notes
        WHERE memory_user_notes.project_id = memory_projects.id
      )
    `)
  }
}
