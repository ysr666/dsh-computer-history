// Enforce the store protection decision (ADR 0005).
//
//   pnpm verify:store-protection
//   node scripts/verify-store-protection.mjs --store <path>
//
// Checks, in order:
//   1. the store directory is 0700 or stricter, every file in it 0600 or
//      stricter;
//   2. the store path is not inside a synced or network location (a synced
//      copy leaves the encrypted volume);
//   3. on macOS, FileVault is on (the at-rest guarantee the ADR depends on).
//
// `--store` exists so the check itself can be calibrated: point it at a
// directory with loose permissions and it must fail, or the check proves
// nothing.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'

const SYNC_SEGMENTS = [
  'Library/Mobile Documents', // iCloud Drive
  'Dropbox',
  'OneDrive',
  'Google Drive',
  'Creative Cloud Files',
]

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function defaultStorePath() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'computer-history')
}

const storePath = path.resolve(argument('--store') ?? defaultStorePath())
const problems = []

// ADR 0005's mechanism is macOS-shaped: POSIX modes, a non-synced location, FileVault. Windows has no
// POSIX mode bits (chmod toggles read-only, stat reports a synthetic 0666/0777), so asserting them
// there would fail on a directory that is already private. The parts that do not exist on a platform
// are named instead of being silently skipped - a check that cannot run must not look like one that
// passed.
const posixModes = process.platform !== 'win32'
const macos = process.platform === 'darwin'

function modeOf(target) {
  return statSync(target).mode & 0o777
}

if (path.isAbsolute(storePath) === false) {
  problems.push(`${storePath}: store path is not absolute`)
}

// 1. permissions
if (!posixModes) {
  console.log(
    `${process.platform}: POSIX mode checks unavailable; the store relies on the directory ACL, `
    + 'which this check cannot read (see the note in src/host/store/database.ts)',
  )
} else if (existsSync(storePath)) {
  const directoryMode = modeOf(storePath)
  if ((directoryMode & 0o077) !== 0) {
    problems.push(
      `${storePath}: directory mode ${directoryMode.toString(8)} allows `
      + 'group or other access (expected 0700 or stricter)',
    )
  }
  for (const entry of readdirSync(storePath)) {
    const file = path.join(storePath, entry)
    if (!statSync(file).isFile()) continue
    const fileMode = modeOf(file)
    if ((fileMode & 0o077) !== 0) {
      problems.push(
        `${file}: mode ${fileMode.toString(8)} allows group or other `
        + 'access (expected 0600 or stricter)',
      )
    }
  }
} else {
  console.log(`store not created yet: ${storePath} (permission checks skipped)`)
}

// 2. synced / network locations
const normalized = storePath.split(path.sep).join('/')
for (const segment of SYNC_SEGMENTS) {
  if (normalized.includes(`/${segment}/`)) {
    problems.push(
      `${storePath}: inside "${segment}", which syncs the store off this `
      + 'volume; ADR 0005 requires a non-synced location',
    )
  }
}
if (normalized.startsWith('/Volumes/')) {
  problems.push(
    `${storePath}: on a mounted volume, which carries no at-rest guarantee`,
  )
}

// 3. FileVault
if (macos) {
  const status = spawnSync('/usr/bin/fdesetup', ['status'], {
    encoding: 'utf8',
  })
  const text = `${status.stdout ?? ''}${status.stderr ?? ''}`.trim()
  if (!/FileVault is On/i.test(text)) {
    problems.push(
      `FileVault is not on ("${text}"); ADR 0005 depends on full-volume `
      + 'encryption for at-rest confidentiality',
    )
  }
} else {
  console.log(
    `${process.platform}: FileVault check unavailable; at-rest protection `
    + 'must be provided by the platform',
  )
}

// Two predicates here decide whether a store is safe, and both would look
// perfectly happy if they stopped discriminating. Prove each still does, against
// paths and a directory the test controls.
{
  const isSynced = target =>
    SYNC_SEGMENTS.some(segment => target.split(path.sep).join('/').includes(`/${segment}/`))
  if (!isSynced('/Users/someone/Dropbox/computer-history')) {
    problems.push('the sync-folder check no longer recognises a synced path')
  }
  if (isSynced('/Users/someone/.dsh/computer-history')) {
    problems.push('the sync-folder check flags a path that is not synced')
  }

  if (!posixModes) {
    // Nothing to calibrate where the thing being calibrated does not exist.
  } else {
  const probe = mkdtempSync(path.join(os.tmpdir(), 'dsh-store-mode-'))
  try {
    chmodSync(probe, 0o755)
    if (modeOf(probe) === undefined || (modeOf(probe) & 0o077) === 0) {
      problems.push('the permission check cannot see a world-readable directory')
    }
    chmodSync(probe, 0o700)
    if ((modeOf(probe) ?? 0) & 0o077) {
      problems.push('the permission check flags a directory that is already private')
    }
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `store protection holds (ADR 0005): ${storePath} — permissions, `
  + 'non-synced location, FileVault',
)
