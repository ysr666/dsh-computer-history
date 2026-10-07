import {
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { verifyCollectorArtifacts } from './collector-artifacts.mjs'

if (process.env.DSH_NATIVE_PREBUILT === '1') {
  verifyCollectorArtifacts(
    path.resolve(import.meta.dirname, '..'),
    process.env.GITHUB_SHA?.trim() || undefined,
  )
  console.log('native collector build skipped: verified staged three-platform release artifacts')
  process.exit(0)
}

if (process.platform !== 'darwin') {
  console.log(
    'native collector build skipped: macOS only',
  )
  process.exit(0)
}

const developer =
  process.env.DEVELOPER_DIR
  ?? '/Applications/Xcode.app/Contents/Developer'
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
const codesign = '/usr/bin/codesign'
const sourceDir =
  'native/macos/Sources/ComputerHistoryCollector'
const sources = readdirSync(sourceDir)
  .filter(name => name.endsWith('.swift'))
  .map(name => path.join(sourceDir, name))
const outputDir = 'bin'
const universal = path.join(
  outputDir,
  'dsh-computer-history-collector',
)
const identifier =
  'ai.deepseek.dsh.computer-history.collector'

mkdirSync(outputDir, { recursive: true })

function run(command, args) {
  const result = spawnSync(
    command,
    args,
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const outputs = []
for (const arch of ['arm64', 'x86_64']) {
  const output = path.join(
    outputDir,
    'collector-' + arch,
  )
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
  universal,
])

const identity =
  process.env.DSH_COMPUTER_HISTORY_CODESIGN_IDENTITY
  ?? '-'
const signArgs = [
  '--force',
  '--sign', identity,
  '--identifier', identifier,
]
const adHoc = identity === '-'
if (adHoc) {
  signArgs.push('--timestamp=none')
} else {
  signArgs.push('--options', 'runtime', '--timestamp')
}
signArgs.push(universal)

run(codesign, signArgs)
run(codesign, [
  '--verify',
  '--strict',
  '--verbose=2',
  universal,
])

console.log(
  adHoc
    ? `built and signed the universal macOS collector ad-hoc (${identifier}) - fine for this machine, not for distribution`
    : `built and signed the universal macOS collector with a Developer ID (${identifier})`,
)
