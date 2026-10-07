import path from 'node:path'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type {
  DshCheckpoint,
  RecordDshCheckpointRequest,
} from '../../shared/index.js'

function text(
  row: Record<string, SQLOutputValue>,
  key: string,
): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function number(
  row: Record<string, SQLOutputValue>,
  key: string,
): number {
  const value = row[key]
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`invalid DSH checkpoint row: ${key} must be numeric`)
  }
  return Number(value)
}

function sameOrChildPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === ''
    || (!path.isAbsolute(relative)
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`))
}

function samePathTree(left: string, right: string): boolean {
  if (!path.isAbsolute(left) || !path.isAbsolute(right)) return false
  const a = path.resolve(left)
  const b = path.resolve(right)
  return sameOrChildPath(a, b) || sameOrChildPath(b, a)
}

function materialize(row: Record<string, SQLOutputValue>): DshCheckpoint {
  const workspaceId = text(row, 'workspace_id')
  const workspaceRoot = text(row, 'workspace_root')
  const workspaceTitle = text(row, 'workspace_title')
  return {
    sessionId: String(row.session_id),
    turn: number(row, 'turn'),
    checkpointAtMs: number(row, 'checkpoint_at_ms'),
    ...(text(row, 'cwd') ? { cwd: text(row, 'cwd')! } : {}),
    ...(workspaceId || workspaceRoot || workspaceTitle
      ? {
          workspace: {
            ...(workspaceId ? { id: workspaceId } : {}),
            ...(workspaceRoot ? { root: workspaceRoot } : {}),
            ...(workspaceTitle ? { title: workspaceTitle } : {}),
          },
        }
      : {}),
    ...(text(row, 'git_head') ? { gitHead: text(row, 'git_head')! } : {}),
  }
}

export class DshCheckpointStore {
  public constructor(private readonly db: DatabaseSync) {}

  public upsert(
    input: RecordDshCheckpointRequest,
    expiresAtMs: number,
  ): DshCheckpoint {
    this.db.prepare(`
      INSERT INTO dsh_checkpoints(
        session_id, turn, checkpoint_at_ms, cwd,
        workspace_id, workspace_root, workspace_title, git_head,
        expires_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, turn) DO UPDATE SET
        checkpoint_at_ms = excluded.checkpoint_at_ms,
        cwd = excluded.cwd,
        workspace_id = excluded.workspace_id,
        workspace_root = excluded.workspace_root,
        workspace_title = excluded.workspace_title,
        git_head = excluded.git_head,
        expires_at_ms = excluded.expires_at_ms
    `).run(
      input.sessionId,
      input.turn,
      input.checkpointAtMs,
      input.cwd ?? null,
      input.workspace?.id ?? null,
      input.workspace?.root ?? null,
      input.workspace?.title ?? null,
      input.gitHead ?? null,
      expiresAtMs,
    )

    const row = this.db.prepare(`
      SELECT * FROM dsh_checkpoints
      WHERE session_id = ? AND turn = ?
    `).get(input.sessionId, input.turn)
    if (!row) throw new Error('DSH checkpoint upsert did not produce a row')
    return materialize(row)
  }

  public latestForWorkspace(request: {
    readonly workspaceId?: string
    readonly workspaceRoot?: string
    readonly atOrBeforeMs: number
  }): DshCheckpoint | undefined {
    if (!request.workspaceId && !request.workspaceRoot) return undefined
    const exact = this.db.prepare(`
      SELECT * FROM dsh_checkpoints
      WHERE checkpoint_at_ms <= ?
        AND (
          (? IS NOT NULL AND workspace_id = ?)
          OR (? IS NOT NULL AND workspace_root = ?)
        )
      ORDER BY checkpoint_at_ms DESC, id DESC
      LIMIT 1
    `).get(
      request.atOrBeforeMs,
      request.workspaceId ?? null,
      request.workspaceId ?? null,
      request.workspaceRoot ?? null,
      request.workspaceRoot ?? null,
    )
    if (exact) return materialize(exact)

    // A checkpoint recorded without a registry-backed workspace id may only
    // know the session cwd. Let that lexical path anchor match a later vouched
    // repo root when one is a parent of the other. Never do this for a
    // checkpoint with an authoritative id: explicit identity beats path shape.
    if (!request.workspaceRoot) return undefined
    const candidates = this.db.prepare(`
      SELECT * FROM dsh_checkpoints
      WHERE checkpoint_at_ms <= ?
        AND workspace_id IS NULL
        AND (workspace_root IS NOT NULL OR cwd IS NOT NULL)
      ORDER BY checkpoint_at_ms DESC, id DESC
      LIMIT 64
    `).all(request.atOrBeforeMs)

    for (const candidate of candidates) {
      const root = text(candidate, 'workspace_root') ?? text(candidate, 'cwd')
      if (root && samePathTree(root, request.workspaceRoot)) {
        return materialize(candidate)
      }
    }
    return undefined
  }

  public deleteExpired(nowMs: number): number {
    return Number(this.db.prepare(
      'DELETE FROM dsh_checkpoints WHERE expires_at_ms <= ?',
    ).run(nowMs).changes)
  }

  public deleteAll(): number {
    return Number(this.db.prepare('DELETE FROM dsh_checkpoints').run().changes)
  }

  public deleteRange(startMs: number, endMs: number): number {
    return Number(this.db.prepare(`
      DELETE FROM dsh_checkpoints
      WHERE checkpoint_at_ms >= ? AND checkpoint_at_ms < ?
    `).run(startMs, endMs).changes)
  }
}
