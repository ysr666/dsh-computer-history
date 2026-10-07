#!/usr/bin/env node
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const artifacts = {
  darwin: 'bin/dsh-computer-history-collector',
  win32: 'bin/dsh-computer-history-collector-windows.exe',
  linux: 'bin/dsh-computer-history-collector-linux',
}

const sourceCommit =
  process.env.DSH_NATIVE_SOURCE_COMMIT
  ?? process.env.GITHUB_SHA
  ?? 'local'

const manifest = {
  schema: 1,
  sourceCommit,
  artifacts: {},
}

for (const [platform, file] of Object.entries(artifacts)) {
  if (!existsSync(file)) {
    console.error(`native artifact is missing for ${platform}: ${file}`)
    process.exit(1)
  }
  const bytes = readFileSync(file)
  manifest.artifacts[platform] = {
    path: file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: statSync(file).size,
  }
}

mkdirSync('bin', { recursive: true })
const target = path.join('bin', 'native-artifacts.json')
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(
  `native artifact manifest written for ${sourceCommit}: ${target}`,
)
