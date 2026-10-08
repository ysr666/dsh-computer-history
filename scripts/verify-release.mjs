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
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

  try {
    execFileSync(
      process.execPath,
      ['scripts/verify-native-package.mjs', tarball],
      {
        stdio: 'inherit',
        env: process.env,
      },
    )
  } catch {
    problems.push(
      'the packaged three-platform native collector verification failed',
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
  `release preflight holds for ${version}: changelog section, every promised entry in the tarball, and all three `
  + 'packaged native collectors match their recorded provenance. The macOS collector signature is verified from '
  + 'the tarball itself on the release runner.',
)
