#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const tarball = process.env.DSH_RELEASE_TARBALL
  ?? process.argv[2]
if (!tarball) {
  console.error(
    'DSH_RELEASE_TARBALL or a tarball path argument is required',
  )
  process.exit(2)
}

const expected = {
  darwin: 'bin/dsh-computer-history-collector',
  win32: 'bin/dsh-computer-history-collector-windows.exe',
  linux: 'bin/dsh-computer-history-collector-linux',
}
const manifestPath = 'bin/native-artifacts.json'
const problems = []
const scratch = mkdtempSync(
  path.join(tmpdir(), 'dsh-native-package-'),
)

function sha256(file) {
  return createHash('sha256')
    .update(readFileSync(file))
    .digest('hex')
}

try {
  const members = execFileSync(
    'tar',
    ['-tzf', tarball],
    { encoding: 'utf8' },
  ).split('\n')

  for (const file of [...Object.values(expected), manifestPath]) {
    const member = `package/${file}`
    if (!members.includes(member)) {
      problems.push(`tarball is missing ${member}`)
    }
  }

  if (problems.length === 0) {
    execFileSync(
      'tar',
      ['-xzf', tarball, '-C', scratch, ...[
        ...Object.values(expected),
        manifestPath,
      ].map(file => `package/${file}`)],
      { stdio: 'ignore' },
    )

    const root = path.join(scratch, 'package')
    const nativeManifest = JSON.parse(
      readFileSync(path.join(root, manifestPath), 'utf8'),
    )
    if (nativeManifest.schema !== 1) {
      problems.push(
        `native artifact manifest schema is ${nativeManifest.schema}, expected 1`,
      )
    }
    if (
      typeof nativeManifest.sourceCommit !== 'string'
      || nativeManifest.sourceCommit.length === 0
    ) {
      problems.push('native artifact manifest has no sourceCommit')
    }
    if (
      process.env.GITHUB_SHA
      && nativeManifest.sourceCommit !== process.env.GITHUB_SHA
    ) {
      problems.push(
        `native artifacts say ${nativeManifest.sourceCommit} but workflow is ${process.env.GITHUB_SHA}`,
      )
    }

    for (const [platform, relative] of Object.entries(expected)) {
      const record = nativeManifest.artifacts?.[platform]
      if (!record || record.path !== relative) {
        problems.push(
          `native artifact manifest has no exact ${platform} record for ${relative}`,
        )
        continue
      }
      const file = path.join(root, relative)
      if (!existsSync(file)) {
        problems.push(`extracted native artifact is missing: ${relative}`)
        continue
      }
      const digest = sha256(file)
      if (record.sha256 !== digest) {
        problems.push(
          `${relative} sha256 is ${digest}, manifest says ${record.sha256}`,
        )
      }
      const size = statSync(file).size
      if (record.size !== size) {
        problems.push(
          `${relative} size is ${size}, manifest says ${record.size}`,
        )
      }
    }

    if (process.platform !== 'win32') {
      for (const relative of [expected.darwin, expected.linux]) {
        const mode = statSync(path.join(root, relative)).mode & 0o777
        if ((mode & 0o111) === 0) {
          problems.push(
            `${relative} is not executable in the tarball (mode ${mode.toString(8)})`,
          )
        }
      }
    }

    if (process.platform === 'darwin') {
      const macBinary = path.join(root, expected.darwin)
      const described = spawnSync(
        'codesign',
        ['-dv', macBinary],
        { encoding: 'utf8' },
      )
      const description =
        `${described.stdout ?? ''}${described.stderr ?? ''}`
      if (!/Signature=|Authority=/.test(description)) {
        problems.push(
          `${expected.darwin} is not signed in the packaged artifact`,
        )
      }
      const verified = spawnSync(
        'codesign',
        ['--verify', '--strict', macBinary],
        { encoding: 'utf8' },
      )
      if (verified.status !== 0) {
        problems.push(
          `${expected.darwin} fails codesign --verify --strict`,
        )
      }
    }
  }
} catch (error) {
  problems.push(
    error instanceof Error ? error.message : String(error),
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `three-platform native package holds: ${Object.values(expected).join(', ')} match their recorded SHA-256 provenance`,
)
