import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const PLATFORM = process.platform
const BINARY_BY_PLATFORM = {
  darwin: 'bin/dsh-computer-history-collector',
  win32: 'bin/dsh-computer-history-collector-windows.exe',
  linux: 'bin/dsh-computer-history-collector-linux',
}
const binary = BINARY_BY_PLATFORM[PLATFORM]
if (!binary) {
  console.error(`unsupported native artifact platform: ${PLATFORM}`)
  process.exit(1)
}

const sourceCommit = process.env.GITHUB_SHA
  ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const bytes = readFileSync(binary)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const metadata = {
  schema: 'dsh-computer-history/native-artifact/v1',
  sourceCommit,
  platform: PLATFORM,
  file: path.basename(binary),
  sha256,
  bytes: statSync(binary).size,
}
const output = `bin/native-artifact-${PLATFORM}.json`
writeFileSync(output, JSON.stringify(metadata, null, 2) + '\n')
console.log(`native artifact metadata written: ${output} ${sha256}`)
