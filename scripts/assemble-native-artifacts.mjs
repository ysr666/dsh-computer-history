import { createHash } from 'node:crypto'
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ENTRIES = [
  { platform: 'darwin', file: 'dsh-computer-history-collector', executable: true },
  { platform: 'win32', file: 'dsh-computer-history-collector-windows.exe', executable: false },
  { platform: 'linux', file: 'dsh-computer-history-collector-linux', executable: true },
]
const sourceCommit = process.env.GITHUB_SHA
  ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const binaries = []

for (const entry of ENTRIES) {
  const binary = path.join('bin', entry.file)
  const metadataPath = path.join('bin', `native-artifact-${entry.platform}.json`)
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  if (metadata.schema !== 'dsh-computer-history/native-artifact/v1') {
    throw new Error(`${metadataPath}: unsupported schema ${metadata.schema}`)
  }
  if (metadata.sourceCommit !== sourceCommit) {
    throw new Error(
      `${metadataPath}: source commit ${metadata.sourceCommit} does not match ${sourceCommit}`,
    )
  }
  if (metadata.platform !== entry.platform || metadata.file !== entry.file) {
    throw new Error(`${metadataPath}: platform/file identity mismatch`)
  }
  const bytes = readFileSync(binary)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (metadata.sha256 !== sha256 || metadata.bytes !== statSync(binary).size) {
    throw new Error(`${binary}: bytes do not match runner metadata`)
  }
  if (entry.executable) chmodSync(binary, 0o755)
  binaries.push({
    platform: entry.platform,
    file: `bin/${entry.file}`,
    sha256,
    bytes: statSync(binary).size,
  })
}

const manifest = {
  schema: 'dsh-computer-history/native-artifacts/v1',
  sourceCommit,
  binaries,
}
writeFileSync(
  'bin/native-artifacts.json',
  JSON.stringify(manifest, null, 2) + '\n',
)
console.log(
  `assembled native artifacts for ${sourceCommit.slice(0, 12)}: `
  + binaries.map(item => `${item.platform}=${item.sha256.slice(0, 12)}`).join(' '),
)
