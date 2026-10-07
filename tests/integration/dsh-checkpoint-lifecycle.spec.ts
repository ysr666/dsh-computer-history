import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportHistory, importHistory } from '../../src/host/audit/export.js'
import { DeletionService } from '../../src/host/retention/deletion.js'
import { RetentionService } from '../../src/host/retention/retention-service.js'
import {
  DshCheckpointStore,
  openHistoryDatabase,
} from '../../src/host/store/index.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function database(label: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), `dsh-checkpoint-${label}-`))
  roots.push(root)
  return openHistoryDatabase({ dataDirectory: root, nowMs: 1 })
}

function write(
  store: DshCheckpointStore,
  atMs: number,
  turn = 1,
  expiresAtMs = atMs + 10_000,
  gitHead?: string,
) {
  return store.upsert({
    sessionId: 'session-1',
    turn,
    checkpointAtMs: atMs,
    cwd: '/repo',
    workspace: { id: 'repo', root: '/repo', title: 'repo' },
    ...(gitHead === undefined ? {} : { gitHead }),
  }, expiresAtMs)
}

describe('DSH checkpoint lifecycle', () => {
  it('round-trips through the audit export and keeps the latest prior workspace boundary', () => {
    const source = database('source')
    const checkpoints = new DshCheckpointStore(source.db)
    write(checkpoints, 100, 1, 10_100, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    write(checkpoints, 300, 2)

    expect(checkpoints.latestForWorkspace({
      workspaceId: 'repo',
      atOrBeforeMs: 250,
    })).toMatchObject({
      turn: 1,
      gitHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })

    const document = exportHistory(source.db, 400)
    expect(document.tables.dsh_checkpoints).toHaveLength(2)

    const target = database('target')
    expect(importHistory(target.db, document).imported.dsh_checkpoints).toBe(2)
    expect(new DshCheckpointStore(target.db).latestForWorkspace({
      workspaceRoot: '/repo',
      atOrBeforeMs: 250,
    })?.gitHead).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(new DshCheckpointStore(target.db).latestForWorkspace({
      workspaceRoot: '/repo',
      atOrBeforeMs: 500,
    })?.turn).toBe(2)

    source.close()
    target.close()
  })


  it('links an unregistered cwd nested under the later vouched workspace root', () => {
    const handle = database('nested-root')
    const checkpoints = new DshCheckpointStore(handle.db)
    checkpoints.upsert({
      sessionId: 'session-nested',
      turn: 3,
      checkpointAtMs: 100,
      cwd: '/repo/src',
      workspace: { root: '/repo/src', title: 'src' },
    }, 10_000)
    checkpoints.upsert({
      sessionId: 'session-sibling',
      turn: 4,
      checkpointAtMs: 200,
      cwd: '/repo-other/src',
      workspace: { root: '/repo-other/src', title: 'src' },
    }, 10_000)

    expect(checkpoints.latestForWorkspace({
      workspaceRoot: '/repo',
      atOrBeforeMs: 500,
    })).toMatchObject({
      sessionId: 'session-nested',
      turn: 3,
    })
    handle.close()
  })

  it('deletes checkpoints with all-history and time-range deletion', () => {
    const handle = database('delete')
    const checkpoints = new DshCheckpointStore(handle.db)
    write(checkpoints, 100, 1)
    write(checkpoints, 300, 2)

    new DeletionService(handle.db).delete({
      scope: { kind: 'time-range', startMs: 50, endMs: 200 },
    }, 500)
    expect(checkpoints.latestForWorkspace({
      workspaceId: 'repo',
      atOrBeforeMs: 500,
    })?.turn).toBe(2)

    new DeletionService(handle.db).delete({ scope: { kind: 'all' } }, 600)
    expect(checkpoints.latestForWorkspace({
      workspaceId: 'repo',
      atOrBeforeMs: 700,
    })).toBeUndefined()
    handle.close()
  })

  it('expires checkpoints under the same sweep lifecycle as history', () => {
    const handle = database('retention')
    const checkpoints = new DshCheckpointStore(handle.db)
    write(checkpoints, 100, 1, 150)
    write(checkpoints, 200, 2, 10_000)

    new RetentionService(handle.db).sweep(500)
    expect(checkpoints.latestForWorkspace({
      workspaceId: 'repo',
      atOrBeforeMs: 500,
    })?.turn).toBe(2)
    handle.close()
  })
})
