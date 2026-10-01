import { mkdirSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

if (process.platform !== 'darwin') {
  console.log('native collector build skipped: macOS only')
  process.exit(0)
}

const developer = process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer'
const sdk = path.join(
  developer,
  'Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
)
const toolchain = path.join(
  developer,
  'Toolchains/XcodeDefault.xctoolchain/usr/bin',
)
const swiftc = path.join(toolchain, 'swiftc')
const lipo = path.join(toolchain, 'lipo')
const sourceDir = 'native/macos/Sources/ComputerHistoryCollector'
const sources = readdirSync(sourceDir)
  .filter(name => name.endsWith('.swift'))
  .map(name => path.join(sourceDir, name))
const outputDir = 'bin'
mkdirSync(outputDir, { recursive: true })

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const outputs = []
for (const arch of ['arm64', 'x86_64']) {
  const output = path.join(outputDir, 'collector-' + arch)
  run(swiftc, [
    '-warnings-as-errors',
    '-sdk', sdk,
    '-target', arch + '-apple-macos13.0',
    ...sources,
    '-o', output,
  ])
  outputs.push(output)
}

run(lipo, [
  '-create',
  ...outputs,
  '-output',
  path.join(outputDir, 'dsh-computer-history-collector'),
])
console.log('built universal macOS collector')
