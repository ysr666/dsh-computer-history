import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalizeResource } from '../../src/host/ingestion/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resource canonicalization', () => {
  it('resolves filesystem symlinks before resource identity is persisted', async () => {
    const created = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-canonical-'),
    )
    roots.push(created)
    const root = realpathSync(created)
    const targetDir = path.join(root, 'actual')
    mkdirSync(targetDir)
    const target = path.join(targetDir, 'provider.ts')
    writeFileSync(target, 'fixture')
    const alias = path.join(root, 'alias.ts')
    symlinkSync(target, alias)

    await expect(canonicalizeResource({
      kind: 'file',
      canonicalUri: pathToFileURL(alias).href,
      displayLabel: 'alias.ts',
    })).resolves.toEqual({
      kind: 'file',
      canonicalUri: pathToFileURL(target).href,
      displayLabel: 'alias.ts',
    })
  })

  it('keeps a normalized absolute identity for a missing file', async () => {
    const created = mkdtempSync(
      path.join(os.tmpdir(), 'dsh-ch-canonical-'),
    )
    roots.push(created)
    const root = realpathSync(created)
    const missing = path.join(root, 'gone', '..', 'missing.ts')

    await expect(canonicalizeResource({
      kind: 'file',
      canonicalUri: pathToFileURL(missing).href,
    })).resolves.toMatchObject({
      kind: 'file',
      canonicalUri: pathToFileURL(
        path.join(root, 'missing.ts'),
      ).href,
    })
  })
})
