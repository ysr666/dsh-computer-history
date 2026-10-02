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

  it('keeps cross-process ownership until local policy leases drain', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-lock-lease-'),
    )
    roots.push(root)
    const target = path.join(root, 'capture-owner')

    const owner = await CaptureOwnershipLock.acquire(target)
    const releaseLease = owner.acquireLease()
    let ownershipReleased = false
    const releasing = owner.release().then(() => {
      ownershipReleased = true
    })

    await Promise.resolve()
    expect(ownershipReleased).toBe(false)
    await expect(
      CaptureOwnershipLock.acquire(target),
    ).rejects.toThrow(/timed out waiting/)

    await releaseLease()
    await releasing
    expect(ownershipReleased).toBe(true)

    const successor = await CaptureOwnershipLock.acquire(target)
    await successor.release()
  })

  it('refuses new local leases once ownership release begins', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-lock-release-'),
    )
    roots.push(root)
    const target = path.join(root, 'capture-owner')

    const owner = await CaptureOwnershipLock.acquire(target)
    const releaseLease = owner.acquireLease()
    const releasing = owner.release()

    expect(() => owner.acquireLease()).toThrow(/releasing/)
    await releaseLease()
    await releasing
  })

})
