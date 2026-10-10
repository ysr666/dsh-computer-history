import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectUpgradeEnvironment } from '../../scripts/upgrade-preflight-core.mjs'

const tempRoots: string[] = []
function fixture({
  pluginVersion = '0.1.0-dev.0',
  dependency = 'file:/tmp/old-plugin.tgz',
  withWal = true,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dch-preflight-'))
  tempRoots.push(root)
  const profile = path.join(root, 'profiles', 'desktop')
  const plugin = path.join(profile, 'node_modules', 'dsh-computer-history')
  const dataDir = path.join(root, 'computer-history')
  mkdirSync(plugin, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { 'dsh-computer-history': dependency },
    dsh: { profile: { bundles: ['dsh-computer-history', 'other-bundle'] } },
  }))
  writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({
    name: 'dsh-computer-history', version: pluginVersion,
  }))
  writeFileSync(path.join(dataDir, 'history.sqlite'), 'unchanged PRIVATE DATA')
  if (withWal) {
    writeFileSync(path.join(dataDir, 'history.sqlite-wal'), 'PENDING WAL')
    writeFileSync(path.join(dataDir, 'history.sqlite-shm'), 'SHM')
  }
  writeFileSync(path.join(dataDir, 'capture-owner.lock'), 'LOCK')
  return { root, profile, dataDir }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('read-only user profile upgrade preflight', () => {
  it('reports the old DSH/Dev plugin and active WAL without modifying private data', () => {
    const { root, profile, dataDir } = fixture()
    const before = [
      readFileSync(path.join(dataDir, 'history.sqlite'), 'utf8'),
      readFileSync(path.join(dataDir, 'history.sqlite-wal'), 'utf8'),
      readFileSync(path.join(profile, 'package.json'), 'utf8'),
    ]
    const mtimeBefore = statSync(path.join(dataDir, 'history.sqlite')).mtimeMs
    const report = inspectUpgradeEnvironment({
      dshHome: root, profile: 'desktop', dshVersion: '0.1.2-rc.1',
    })
    expect(report).toMatchObject({
      mode: 'read-only', profile: 'desktop', readiness: 'requires-separate-approval',
      cli: { compatibility: 'incompatible' },
      plugin: {
        installedVersion: '0.1.0-dev.0',
        dependencyKind: 'local-file-or-link', bundleEnabledInManifest: true,
        otherBundleCount: 1,
      },
      historyFiles: {
        database: { present: true },
        writeAheadLog: { present: true },
        sharedMemory: { present: true },
      },
    })
    expect(report.blockers.join(' ')).toContain('NOT a reliable backup')
    expect(report.blockers.join(' ')).toContain('0.1.x')
    expect(report.nextSteps.join(' ')).toContain('schema migration')
    const after = [
      readFileSync(path.join(dataDir, 'history.sqlite'), 'utf8'),
      readFileSync(path.join(dataDir, 'history.sqlite-wal'), 'utf8'),
      readFileSync(path.join(profile, 'package.json'), 'utf8'),
    ]
    expect(after).toEqual(before)
    expect(statSync(path.join(dataDir, 'history.sqlite')).mtimeMs).toBe(mtimeBefore)
    expect(JSON.stringify(report)).not.toContain('PRIVATE DATA')
    expect(JSON.stringify(report)).not.toContain('PENDING WAL')
  })

  it('marks exactly measured DSH versions as tested without granting approval', () => {
    const { root } = fixture({ pluginVersion: '1.1.0', withWal: false })
    for (const dshVersion of ['0.2.0-rc.2', '0.2.1-alpha.2']) {
      const report = inspectUpgradeEnvironment({
        dshHome: root, dshVersion,
      })
      expect(report.cli.compatibility).toBe('tested')
      expect(report.readiness).toBe('requires-separate-approval')
      expect(report.blockers).toEqual([])
    }
    const unverified = inspectUpgradeEnvironment({
      dshHome: root, dshVersion: '0.2.4',
    })
    expect(unverified.cli.compatibility).toBe('unverified')
    expect(unverified.blockers).toHaveLength(1)
  })

  it('does not read a user-chosen profile outside the DSH profiles directory', () => {
    const { root } = fixture()
    expect(() => inspectUpgradeEnvironment({
      dshHome: root, profile: '../../private', dshVersion: '0.2.1-alpha.2',
    })).toThrow(/invalid DSH profile/)
    expect(() => inspectUpgradeEnvironment({
      dshHome: 'relative/path', dshVersion: '0.2.1-alpha.2',
    })).toThrow(/absolute/)
  })

  it('recognizes an absent profile and no history without inventing a running Host', () => {
    const { root } = fixture()
    const report = inspectUpgradeEnvironment({
      dshHome: root, profile: 'missing', dshVersion: '0.2.1-alpha.2',
    })
    expect(report.blockers).toContain('Requested DSH profile manifest is missing.')
    expect(report.historyFiles.database.present).toBe(true)
    expect(report.plugin.installedVersion).toBeNull()
  })

  it('CLI --json emits only structural read-only data, with documented nonzero blocker code', () => {
    const { root } = fixture()
    const result = spawnSync(process.execPath, [
      'scripts/preflight-local-upgrade.mjs',
      '--dsh-home', root, '--profile', 'desktop',
      '--json',
    ], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      encoding: 'utf8', timeout: 5000,
    })
    expect(result.status).toBe(2)
    const body = JSON.parse(result.stdout)
    expect(body.historyFiles.database.present).toBe(true)
    expect(body.blockers).toContain(
      'SQLite WAL/SHM files are present: a raw copy of history.sqlite alone is NOT a reliable backup.',
    )
    expect(result.stdout).not.toContain('PRIVATE DATA')
    expect(result.stdout).not.toContain('PENDING WAL')
  })
})
