#!/usr/bin/env node
// What has to be true before a release artifact is published, in one place.
//
//   pnpm verify:release
//
// The release workflow runs this before it creates anything, and running it by hand is how you find out what is
// missing while a tag is still cheap to move. It checks the four things that a release has actually gone wrong
// on in this repository's family: a version that still says -dev, a changelog with no section for the version,
// a tarball that does not contain everything `files` promises (which is how the editor extension could have
// shipped missing), and a collector signed ad-hoc, which Gatekeeper blocks on every machine that did not build
// it.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)

const problems = []
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const version = manifest.version

if (typeof version !== 'string' || version.length === 0) {
  problems.push('package.json has no version')
} else if (/-dev/.test(version)) {
  problems.push(`package.json still says ${version}: a release version must not be a -dev one`)
}

// The classic release bug: the tag says one thing and the package says another, and the artifact is named after
// whichever one was read last.
const tag = process.env.GITHUB_REF_NAME
if (tag !== undefined && tag !== `v${version}`) {
  problems.push(`the tag is ${tag} and package.json says ${version}: they have to agree (v${version})`)
}

const changelog = readFileSync('CHANGELOG.md', 'utf8')
// The reader is only worth anything if it still recognises the file: a check that silently matches nothing
// looks exactly like a clean release.
if (!/^## /m.test(changelog)) {
  problems.push('CHANGELOG.md has no "## " section at all - the changelog check proves nothing')
} else if (typeof version === 'string') {
  const section = new RegExp(`^## ${version.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'm')
  if (!section.test(changelog)) {
    problems.push(`CHANGELOG.md has no "## ${version}" section: the release notes come from there`)
  }
}

const expectedNative = [
  { platform: 'darwin', file: 'bin/dsh-computer-history-collector', executable: true },
  { platform: 'win32', file: 'bin/dsh-computer-history-collector-windows.exe', executable: false },
  { platform: 'linux', file: 'bin/dsh-computer-history-collector-linux', executable: true },
]
let signatureKind = 'unknown'
const scratch = mkdtempSync(path.join(tmpdir(), 'dsh-release-'))
try {
  const provided = process.env.DSH_RELEASE_TARBALL
  const packDir = provided === undefined ? scratch : path.dirname(provided)
  if (provided === undefined) {
    execFileSync('pnpm', ['pack', '--pack-destination', scratch], { stdio: 'inherit' })
  }
  const tarball = provided ?? path.join(
    packDir,
    `dsh-computer-history-${version}.tgz`,
  )
  const members = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n')
  for (const entry of manifest.files ?? []) {
    const wanted = `package/${entry}`
    if (!members.some(member => member === wanted || member.startsWith(`${wanted}/`))) {
      problems.push(`files promises ${entry} and the tarball does not contain it`)
    }
  }

  const extracted = path.join(scratch, 'extracted')
  execFileSync('mkdir', ['-p', extracted])
  execFileSync('tar', ['-xzf', tarball, '-C', extracted, 'package/bin'])
  const packageRoot = path.join(extracted, 'package')
  const provenancePath = path.join(packageRoot, 'bin', 'native-artifacts.json')
  let provenance
  try {
    provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
  } catch (error) {
    problems.push(
      `native artifact provenance is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const currentCommit = process.env.GITHUB_SHA
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (provenance) {
    if (provenance.schema !== 'dsh-computer-history/native-artifacts/v1') {
      problems.push(`native-artifacts.json has unsupported schema ${provenance.schema}`)
    }
    if (provenance.sourceCommit !== currentCommit) {
      problems.push(
        `native artifacts came from ${provenance.sourceCommit ?? '(missing commit)'} instead of ${currentCommit}`,
      )
    }
  }

  for (const expected of expectedNative) {
    const binary = path.join(packageRoot, expected.file)
    let bytes
    try {
      bytes = readFileSync(binary)
    } catch {
      problems.push(`${expected.file} is missing from the extracted release tarball`)
      continue
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const recorded = provenance?.binaries?.find(
      item => item.platform === expected.platform && item.file === expected.file,
    )
    if (!recorded) {
      problems.push(`native-artifacts.json has no ${expected.platform} entry for ${expected.file}`)
    } else {
      if (recorded.sha256 !== sha256) {
        problems.push(`${expected.file} hash does not match native-artifacts.json`)
      }
      if (recorded.bytes !== bytes.byteLength) {
        problems.push(`${expected.file} byte count does not match native-artifacts.json`)
      }
    }
    if (expected.executable && (statSync(binary).mode & 0o111) === 0) {
      problems.push(`${expected.file} lost its executable bit in the tarball`)
    }
  }

  const binary = path.join(packageRoot, 'bin', 'dsh-computer-history-collector')
  const described = spawnSync('codesign', ['-dv', binary], { encoding: 'utf8' })
  const description = `${described.stdout ?? ''}${described.stderr ?? ''}`
  signatureKind = /Developer ID Application/.test(description) ? 'Developer ID' : 'ad-hoc'
  if (!/Signature=|Authority=/.test(description)) {
    problems.push('the packaged macOS collector is not signed at all')
  }
  try {
    execFileSync('codesign', ['--verify', '--strict', binary], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    problems.push(
      `the packaged macOS collector fails codesign --verify --strict: `
      + String(error.stderr ?? '').trim().slice(-120),
    )
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(
  `release preflight holds for ${version}: changelog, every promised tarball entry, three native collectors, `
  + `per-runner SHA-256 provenance from this commit, executable modes, and macOS signature (${signatureKind}).`,
)
