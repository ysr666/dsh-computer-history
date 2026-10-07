import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const outputDir = 'bin'
const outputs = {
  darwin: path.join(outputDir, 'dsh-computer-history-collector'),
  win32: path.join(outputDir, 'dsh-computer-history-collector-windows.exe'),
  linux: path.join(outputDir, 'dsh-computer-history-collector-linux'),
}

const output = outputs[process.platform]
if (!output) {
  console.error(`native collector build unsupported on ${process.platform}`)
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })

if (process.env.DSH_NATIVE_PREBUILT === '1') {
  if (!existsSync(output)) {
    console.error(`prebuilt collector is missing for ${process.platform}: ${output}`)
    process.exit(1)
  }
  if (process.platform !== 'win32') chmodSync(output, 0o755)
  console.log(`using staged native collector for ${process.platform}: ${output}`)
  process.exit(0)
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (process.platform === 'win32') {
  run('cargo', [
    'build',
    '--release',
    '--manifest-path', 'native/windows/Cargo.toml',
  ])
  const built = path.join(
    'native', 'windows', 'target', 'release',
    'dsh-computer-history-collector-windows.exe',
  )
  copyFileSync(built, output)
  console.log(`built Windows collector: ${output}`)
  process.exit(0)
}

if (process.platform === 'linux') {
  run('cargo', [
    'build',
    '--release',
    '--manifest-path', 'native/linux/Cargo.toml',
  ])
  const built = path.join(
    'native', 'linux', 'target', 'release',
    'dsh-computer-history-collector-linux',
  )
  copyFileSync(built, output)
  chmodSync(output, 0o755)
  console.log(`built Linux collector: ${output}`)
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
const identifier =
  'ai.deepseek.dsh.computer-history.collector'

const architectureOutputs = []
for (const arch of ['arm64', 'x86_64']) {
  const architectureOutput = path.join(
    outputDir,
    'collector-' + arch,
  )
  run(swiftc, [
    '-warnings-as-errors',
    '-sdk', sdk,
    '-target', arch + '-apple-macos13.0',
    ...sources,
    '-o', architectureOutput,
  ])
  architectureOutputs.push(architectureOutput)
}

run(lipo, [
  '-create',
  ...architectureOutputs,
  '-output',
  output,
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
signArgs.push(output)

run(codesign, signArgs)
run(codesign, [
  '--verify',
  '--strict',
  '--verbose=2',
  output,
])
chmodSync(output, 0o755)

console.log(
  adHoc
    ? `built and signed the universal macOS collector ad-hoc (${identifier})`
    : `built and signed the universal macOS collector with a Developer ID (${identifier})`,
)
