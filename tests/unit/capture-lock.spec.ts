import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'
import {
  CaptureOwnershipLock,
} from '../../src/host/collector/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, {
      recursive: true,
      force: true,
    })
  }
})

describe('capture ownership lock', () => {
  it('permits only one live collector owner', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-lock-'),
    )
    roots.push(root)
    const target =
      path.join(root, 'capture-owner')

    const first =
      await CaptureOwnershipLock.acquire(target)

    await expect(
      CaptureOwnershipLock.acquire(target),
    ).rejects.toThrow(/timed out waiting/)

    await first.release()

    const second =
      await CaptureOwnershipLock.acquire(target)
    await second.release()
  })
})
