import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { EpisodeSummary } from '../../shared/index.js'
import { memoryIdForThreadKey } from '../memory/index.js'

/** User-created text is not model-generated, observed, or verified by the Host. */
export interface UserMemoryNote {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly text: string
  readonly evidenceLevel: 'user-confirmed'
  readonly createdAtMs: number
  readonly updatedAtMs: number
}

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

  public list(projectId?: string, limit = 100): readonly UserMemoryNote[] {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)))
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
