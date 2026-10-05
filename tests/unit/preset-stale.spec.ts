import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findStaleInstall } from '../../src/shared/preset.js'

// The check this covers was removed once for crying wolf: it compared the artifact's timestamp with the
// installed copy's, and pnpm hard-links installed files out of its content-addressed store, so the installed
// file carries the store entry's timestamp and looks older by construction - every install looked stale. What
// decides it now is the digest pnpm recorded for the artifact, which hard links cannot fake: they share
// content, not time.

const scratch: string[] = []
function scratchRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-preset-stale-'))
  scratch.push(root)
  return root
}

afterAll(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true })
})

function integrityOf(content: string): string {
  return `sha512-${createHash('sha512').update(content).digest('base64')}`
}

/** A profile shaped the way pnpm writes one: a file: dependency, an installed copy, and a lockfile. */
function profile(options: {
  artifact: string
  installedAt: string
  recorded?: string
}): { profilesRoot: string, loadedFrom: string } {
  const root = scratchRoot()
  const profileRoot = path.join(root, 'desktop')
  const loadedFrom = path.join(profileRoot, 'node_modules', 'dsh-computer-history')
  mkdirSync(loadedFrom, { recursive: true })
  writeFileSync(path.join(profileRoot, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: { 'dsh-computer-history': `file:${options.artifact}` },
  }))
  if (options.recorded !== undefined) {
    writeFileSync(path.join(profileRoot, 'pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      '',
      'importers:',
      '',
      '  .:',
      '    dependencies:',
      '      dsh-computer-history:',
      `        specifier: file:${options.artifact}`,
      '        version: file:../../artifact.tgz',
      '',
      'packages:',
      '',
      `  dsh-computer-history@file:${options.artifact}:`,
      `    resolution: {integrity: ${options.recorded}, tarball: file:${options.artifact}}`,
      '',
    ].join('\n'))
  }
  // an installed entry point whose mtime is older than the artifact, exactly as a pnpm hard link looks
  const installedEntry = path.join(loadedFrom, 'lib', 'index.js')
  mkdirSync(path.dirname(installedEntry), { recursive: true })
  writeFileSync(installedEntry, 'built earlier')
  const older = new Date(options.installedAt)
  utimesSync(installedEntry, older, older)
  // the plugin is loaded through a resolved path (import.meta.url on macOS is already /private/...), so the
  // fixture offers the same thing rather than the raw /var/folders spelling mkdtemp hands back
  return { profilesRoot: root, loadedFrom: realpathSync(loadedFrom) }
}

describe('stale install detection', () => {
  it('stays quiet when the artifact still matches what pnpm recorded, however old the installed copy looks', () => {
    const root = scratchRoot()
    const artifact = path.join(root, 'artifact.tgz')
    const content = 'the artifact as installed'
    writeFileSync(artifact, content)
    const { profilesRoot, loadedFrom } = profile({
      artifact,
      installedAt: '2020-01-01T00:00:00Z',
      recorded: integrityOf(content),
    })
    expect(findStaleInstall(loadedFrom, profilesRoot)).toBeUndefined()
  })

  it('reports the profile when the artifact was rebuilt after the install', () => {
    const root = scratchRoot()
    const artifact = path.join(root, 'artifact.tgz')
    writeFileSync(artifact, 'the artifact as installed')
    const { profilesRoot, loadedFrom } = profile({
      artifact,
      installedAt: '2020-01-01T00:00:00Z',
      recorded: integrityOf('the artifact as installed'),
    })
    writeFileSync(artifact, 'rebuilt, not reinstalled')

    const stale = findStaleInstall(loadedFrom, profilesRoot)
    expect(stale?.profile).toBe('desktop')
    expect(stale?.artifact).toBe(artifact)
    expect(stale?.updateCommand).toBe(`dsh plugin --profile desktop add ${artifact}`)
  })

  it('says nothing when the lockfile recorded no integrity for this dependency', () => {
    const root = scratchRoot()
    const artifact = path.join(root, 'artifact.tgz')
    writeFileSync(artifact, 'anything')
    const { profilesRoot, loadedFrom } = profile({
      artifact,
      installedAt: '2020-01-01T00:00:00Z',
    })
    expect(findStaleInstall(loadedFrom, profilesRoot)).toBeUndefined()
  })

  it('says nothing when the artifact is gone', () => {
    const root = scratchRoot()
    const artifact = path.join(root, 'artifact.tgz')
    writeFileSync(artifact, 'anything')
    const { profilesRoot, loadedFrom } = profile({
      artifact,
      installedAt: '2020-01-01T00:00:00Z',
      recorded: integrityOf('anything'),
    })
    rmSync(artifact)
    expect(findStaleInstall(loadedFrom, profilesRoot)).toBeUndefined()
  })

  it('ignores a profile that runs a different copy', () => {
    const root = scratchRoot()
    const artifact = path.join(root, 'artifact.tgz')
    writeFileSync(artifact, 'anything')
    const { profilesRoot } = profile({
      artifact,
      installedAt: '2020-01-01T00:00:00Z',
      recorded: integrityOf('anything'),
    })
    expect(findStaleInstall(path.join(scratchRoot(), 'elsewhere'), profilesRoot)).toBeUndefined()
  })
})
