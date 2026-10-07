#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const specs = [
  {
    platform: 'darwin',
    arch: 'universal',
    file: 'dsh-computer-history-collector',
  },
  {
    platform: 'win32',
    arch: 'x64',
    file: 'dsh-computer-history-collector-windows.exe',
  },
  {
    platform: 'linux',
    arch: 'x64',
    file: 'dsh-computer-history-collector-linux',
  },
]

const bin = path.resolve('bin')
mkdirSync(bin, { recursive: true })

const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
const sourceCommit = (process.env.GITHUB_SHA || git.stdout || '').trim()
if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
  console.error('cannot determine the 40-character source commit for native artifact provenance')
  process.exit(1)
}

const artifacts = specs.flatMap(spec => {
  const absolute = path.join(bin, spec.file)
  if (!existsSync(absolute)) return []
  const bytes = readFileSync(absolute)
  return [{
    ...spec,
    path: `bin/${spec.file}`,
    bytes: statSync(absolute).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }]
})

const manifest = {
  schema: 'dsh-computer-history/native-artifacts/v1',
  sourceCommit,
  ...(process.env.GITHUB_RUN_ID
    ? { workflowRunId: process.env.GITHUB_RUN_ID }
    : {}),
  artifacts,
}

writeFileSync(
  path.join(bin, 'native-artifacts.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)
console.log(
  `native artifact manifest: ${artifacts.length}/${specs.length} binaries from ${sourceCommit.slice(0, 12)}`,
)
