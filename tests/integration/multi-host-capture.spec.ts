import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EpisodeId } from '../../src/shared/index.js'
import {
  CaptureOwnershipLock,
} from '../../src/host/collector/index.js'
import { DeletionService } from '../../src/host/retention/index.js'
import {
  EpisodeStore,
  openHistoryDatabase,
} from '../../src/host/store/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('multi-Host capture ownership', () => {
  it('keeps capture single-owner while non-owner history access remains available', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-multi-host-'),
    )
    roots.push(root)
    const dataDirectory = path.join(root, 'history')
    const first = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })
    const second = openHistoryDatabase({
      dataDirectory,
      nowMs: 1,
    })
    const episodeId = EpisodeId('episode:multi-host:1')
    first.db.prepare(`
      INSERT INTO episodes(
        id, started_at_ms, ended_at_ms,
        start_reason, end_reason,
        summary_kind, summary_text,
        confidence, state,
        created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES (?, 100, 200, ?, ?, ?, ?, 1, ?, 200, 200, 100000)
    `).run(
      episodeId,
      'first-observation',
      'timeout',
      'deterministic',
      'multi-host fixture',
      'closed',
    )

    const lockPath = path.join(dataDirectory, 'capture-owner')
    const owner = await CaptureOwnershipLock.acquire(lockPath)
    await expect(
      CaptureOwnershipLock.acquire(lockPath),
    ).rejects.toThrow(/timed out waiting/)

    expect(
      new EpisodeStore(second.db).get(episodeId),
    ).toMatchObject({
      id: episodeId,
      summary: 'multi-host fixture',
    })

    expect(
      new DeletionService(second.db).delete({
        scope: { kind: 'episode', episodeId },
      }, 500),
    ).toEqual({
      observationsDeleted: 0,
      episodesDeleted: 1,
      episodesRebuilt: 0,
    })
    expect(
      new EpisodeStore(first.db).get(episodeId),
    ).toBeUndefined()

    await owner.release()
    const successor = await CaptureOwnershipLock.acquire(lockPath)
    await successor.release()

    second.close()
    first.close()
  })
})
