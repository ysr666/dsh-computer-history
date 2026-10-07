#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const tarball = process.env.DSH_RELEASE_TARBALL ?? process.argv[2]
if (!tarball) {
  console.error('usage: DSH_RELEASE_TARBALL=<plugin.tgz> node scripts/verify-native-package.mjs')
  process.exit(2)
}

const required = [
  'bin/dsh-computer-history-collector',
  'bin/dsh-computer-history-collector-windows.exe',
  'bin/dsh-computer-history-collector-linux',
]
const members = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n')
const manifestMember = 'package/bin/native-artifacts.json'
const problems = []

for (const entry of required) {
  if (!members.includes(`package/${entry}`)) {
    problems.push(`missing packaged collector: ${entry}`)
  }
}
if (!members.includes(manifestMember)) {
  problems.push('missing native artifact manifest')
} else {
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOzf', tarball, manifestMember], { encoding: 'utf8' }),
  )
  if (manifest.schema !== 'dsh-computer-history/native-artifacts/v1') {
    problems.push('unexpected native artifact manifest schema')
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest.sourceCommit ?? '')) {
    problems.push('native artifact manifest has no valid source commit')
  } else if (
    process.env.GITHUB_SHA
    && manifest.sourceCommit.toLowerCase() !== process.env.GITHUB_SHA.toLowerCase()
  ) {
    problems.push(
      `native artifact manifest source ${manifest.sourceCommit} does not match workflow source ${process.env.GITHUB_SHA}`,
    )
  }
  const byPath = new Map((manifest.artifacts ?? []).map(item => [item.path, item]))
  for (const entry of required) {
    const item = byPath.get(entry)
    if (!item) {
      problems.push(`manifest missing ${entry}`)
      continue
    }
    const bytes = execFileSync('tar', ['-xOzf', tarball, `package/${entry}`])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (item.sha256 !== sha256) {
      problems.push(`hash mismatch for ${entry}`)
    }
    const expected = {
      'bin/dsh-computer-history-collector': ['darwin', 'universal'],
      'bin/dsh-computer-history-collector-windows.exe': ['win32', 'x64'],
      'bin/dsh-computer-history-collector-linux': ['linux', 'x64'],
    }[entry]
    if (
      expected
      && (item.platform !== expected[0] || item.arch !== expected[1])
    ) {
      problems.push(
        `manifest identity mismatch for ${entry}: ${item.platform}/${item.arch}`,
      )
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('native package verification passed: darwin + win32 + linux collectors are present and hashed')
