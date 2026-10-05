import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runningRelease } from '../../src/shared/preset.js'

// `runningRelease` used to date the build from `lib/index.js`'s mtime. Installed through pnpm's
// content-addressed store, that mtime belongs to whichever store entry already held the content: measured
// 2026-10-06, a run reported a build 18 minutes older than the code it was running, and the independent
// verifier traced it to the store file whose name is the sha512 of `lib/index.js`. The stamp the build writes
// is the answer; the absence of a stamp must not fall back to the mtime.

function fakePackage(stamp: unknown): { dir: string, entry: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-release-'))
  mkdirSync(path.join(dir, 'lib'), { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'probe', version: '9.9.9' }))
  writeFileSync(path.join(dir, 'lib', 'index.js'), '// built long ago\n')
  if (stamp !== undefined) writeFileSync(path.join(dir, 'lib', 'build-info.json'), JSON.stringify({ builtAtMs: stamp }))
  return { dir, entry: path.join(dir, 'lib', 'index.js') }
}

describe('runningRelease', () => {
  it('reports the build stamp, not the file mtime', () => {
    const { dir, entry } = fakePackage(1_700_000_000_000)
    try {
      const release = runningRelease(entry)
      expect(release?.version).toBe('9.9.9')
      expect(release?.builtAtMs).toBe(1_700_000_000_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('says nothing about the build time when there is no stamp', () => {
    const { dir, entry } = fakePackage(undefined)
    try {
      // The file exists and has an mtime; that mtime is exactly what must not be used.
      expect(runningRelease(entry)?.builtAtMs).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
