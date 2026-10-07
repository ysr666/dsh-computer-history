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
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  execFileSync('tar', ['-xzf', tarball, '-C', scratch])
  const packagedRoot = path.join(scratch, 'package')
  for (const entry of manifest.files ?? []) {
    const wanted = `package/${entry}`
    if (!members.some(member => member === wanted || member.startsWith(`${wanted}/`))) {
      problems.push(`files promises ${entry} and the tarball does not contain it`)
    }
  }

  const requiredNative = [
    'bin/dsh-computer-history-collector',
    'bin/dsh-computer-history-collector-windows.exe',
    'bin/dsh-computer-history-collector-linux',
  ]
  for (const entry of requiredNative) {
    if (!members.includes(`package/${entry}`)) {
      problems.push(`release tarball is missing required native collector ${entry}`)
    }
  }

  const nativeManifestMember = 'package/bin/native-artifacts.json'
  if (!members.includes(nativeManifestMember)) {
    problems.push('release tarball is missing bin/native-artifacts.json')
  } else {
    const nativeManifest = JSON.parse(
      execFileSync('tar', ['-xOzf', tarball, nativeManifestMember], { encoding: 'utf8' }),
    )
    if (nativeManifest.schema !== 'dsh-computer-history/native-artifacts/v1') {
      problems.push('native artifact manifest has an unknown schema')
    }
    const byPath = new Map((nativeManifest.artifacts ?? []).map(item => [item.path, item]))
    for (const entry of requiredNative) {
      const item = byPath.get(entry)
      if (!item) {
        problems.push(`native artifact manifest does not describe ${entry}`)
        continue
      }
      const bytes = execFileSync('tar', ['-xOzf', tarball, `package/${entry}`])
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (sha256 !== item.sha256) {
        problems.push(`native artifact hash mismatch for ${entry}`)
      }
    }
    if (!/^[0-9a-f]{40}$/i.test(nativeManifest.sourceCommit ?? '')) {
      problems.push('native artifact manifest has no valid source commit')
    }
  }

  for (const executable of [
    'bin/dsh-computer-history-collector',
    'bin/dsh-computer-history-collector-linux',
  ]) {
    const packagedExecutable = path.join(packagedRoot, executable)
    if ((statSync(packagedExecutable).mode & 0o111) === 0) {
      problems.push(`release tarball has no executable bit on ${executable}`)
    }
  }

  const binary = path.join(
    packagedRoot,
    'bin/dsh-computer-history-collector',
  )
  // Verify the exact macOS bytes extracted from the release tarball, not the
  // checkout's bin/ copy. A valid working-tree signature proves nothing if the
  // archive that users install contains different bytes.
  // `codesign -dv` writes its description to **stderr**, so a helper that only returns stdout reads an empty
  // string and reports a signed binary as unsigned - which is what the first version of this check did.
  const described = spawnSync('codesign', ['-dv', binary], { encoding: 'utf8' })
  const description = `${described.stdout ?? ''}${described.stderr ?? ''}`
  signatureKind = /Developer ID Application/.test(description) ? 'Developer ID' : 'ad-hoc'
  if (!/Signature=|Authority=/.test(description)) {
    problems.push(
      `${binary} is not signed at all: an unsigned arm64 binary is killed by the kernel ("Killed: 9", measured `
      + 'on this machine), so the collector would not run for anyone. An ad-hoc signature is enough for a plugin '
      + 'install; docs/release.md says when a Developer ID would become necessary.',
    )
  }
  try {
    execFileSync('codesign', ['--verify', '--strict', binary], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    problems.push(`${binary} fails codesign --verify --strict: ${String(error.stderr ?? '').trim().slice(-120)}`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(
  `release preflight holds for ${version}: changelog section, every promised entry in the tarball, and a `
  + `signature that verifies (${signatureKind}). No certificate is needed for a DSH plugin install: the CLI downloads `
  + 'the tarball with Node, which sets no quarantine flag, and a quarantined ad-hoc binary was measured to run.',
)
