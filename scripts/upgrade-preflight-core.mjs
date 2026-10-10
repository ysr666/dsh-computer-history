import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SUPPORTED_DSH = new Set(['0.2.0-rc.2', '0.2.1-alpha.2'])
const INSTALL_PACKAGE = 'dsh-computer-history'

function fileInfo(filepath) {
  try {
    const stat = statSync(filepath)
    return { present: stat.isFile(), sizeBytes: stat.size }
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, sizeBytes: null }
    throw error
  }
}

function jsonIfExists(filepath) {
  if (!existsSync(filepath)) return null
  return JSON.parse(readFileSync(filepath, 'utf8'))
}

function classifyCLI(version) {
  const exact = String(version ?? '').trim()
  if (SUPPORTED_DSH.has(exact)) return 'tested'
  if (exact.startsWith('0.1.')) return 'incompatible'
  return 'unverified'
}

/**
 * Structural inventory only: no database opens, user history content reads,
 * process termination, plugin installation, filesystem write, or schedule change.
 */
export function inspectUpgradeEnvironment({
  dshHome, profile = 'desktop', dshVersion = null,
}) {
  if (!path.isAbsolute(dshHome)) throw new Error('dshHome must be absolute')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(profile)) {
    throw new Error('invalid DSH profile')
  }
  const profileDir = path.join(dshHome, 'profiles', profile)
  const manifest = jsonIfExists(path.join(profileDir, 'package.json'))
  const deployed = jsonIfExists(path.join(
    profileDir, 'node_modules', INSTALL_PACKAGE, 'package.json',
  ))
  const dependency = manifest?.dependencies?.[INSTALL_PACKAGE] ?? null
  const bundles = [
    ...(Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []),
    ...(Array.isArray(manifest?.bundles) ? manifest.bundles : []),
  ]
  const dataDir = path.join(dshHome, 'computer-history')
  const db = fileInfo(path.join(dataDir, 'history.sqlite'))
  const wal = fileInfo(path.join(dataDir, 'history.sqlite-wal'))
  const shm = fileInfo(path.join(dataDir, 'history.sqlite-shm'))
  const lock = fileInfo(path.join(dataDir, 'capture-owner.lock'))
  const cliCompatibility = classifyCLI(dshVersion)
  const blockers = []
  const cautions = []

  if (!manifest) blockers.push('Requested DSH profile manifest is missing.')
  if (cliCompatibility === 'incompatible') {
    blockers.push('DSH 0.1.x does not provide the verified Computer History v1.1 UI/runtime integration.')
  } else if (cliCompatibility === 'unverified') {
    blockers.push('Installed DSH CLI version is unknown or not an explicitly tested version.')
  }
  if (db.present) {
    cautions.push('Existing history must be preserved across schema migration; the older plugin has no verified downgrade path.')
  }
  if (db.present && (wal.present || shm.present)) {
    blockers.push('SQLite WAL/SHM files are present: a raw copy of history.sqlite alone is NOT a reliable backup.')
  }
  if (lock.present) {
    cautions.push('Collector ownership lock exists; verify Host and collectors are stopped before any maintenance.')
  }
  if (!dependency) {
    cautions.push('The selected profile does not declare Computer History as a dependency.')
  } else if (/^(?:file:|link:)/.test(dependency)) {
    cautions.push('The profile depends on a local file/link package; do not replace its bytes in place.')
  }
  if (deployed?.version && /-dev\./.test(deployed.version)) {
    cautions.push('The installed Computer History version is a development build.')
  }
  if (bundles.filter(name => name !== INSTALL_PACKAGE).length > 0) {
    cautions.push('This profile has other bundles; check coexistence in an isolated profile before any live upgrade.')
  }
  return {
    mode: 'read-only',
    profile,
    cli: { version: dshVersion, compatibility: cliCompatibility,
      verifiedVersions: [...SUPPORTED_DSH] },
    plugin: {
      installedVersion: deployed?.version ?? null,
      dependencyKind: typeof dependency === 'string'
        ? (/^(file:|link:)/.test(dependency) ? 'local-file-or-link' : 'registry-or-remote')
        : 'none',
      bundleEnabledInManifest: bundles.includes(INSTALL_PACKAGE),
      otherBundleCount: new Set(bundles.filter(name => name !== INSTALL_PACKAGE)).size,
    },
    historyFiles: {
      database: db, writeAheadLog: wal, sharedMemory: shm, captureOwnerLock: lock,
    },
    readiness: 'requires-separate-approval',
    blockers,
    cautions,
    nextSteps: [
      'Do not mutate the active profile or history during preflight.',
      'Test the target DSH and Computer History package in a separate DSH_HOME and profile.',
      'Stop the original Host/collector before migration or restore.',
      'With WAL present, make a consistent SQLite backup using SQLite backup API or equivalent safe snapshot, not a single-file copy.',
      'Verify backup restore and matching profile/companion configuration in isolation.',
      'Obtain explicit owner approval before changing default CLI, installed plugin, or persistent database.',
      'For rollback after schema migration, restore the pre-upgrade coherent database snapshot and old compatible CLI/plugin/profile together; never rely on schema downgrade.',
    ],
  }
}
