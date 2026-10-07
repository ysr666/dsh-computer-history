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
const platformOutput = {
  darwin: path.join(outputDir, 'dsh-computer-history-collector'),
  win32: path.join(outputDir, 'dsh-computer-history-collector-windows.exe'),
  linux: path.join(outputDir, 'dsh-computer-history-collector-linux'),
}

mkdirSync(outputDir, { recursive: true })

function run(command, args) {
  const result = spawnSync(
    command,
    args,
    { stdio: 'inherit' },
  )
  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const prebuilt = process.env.DSH_NATIVE_PREBUILT === '1'
if (prebuilt) {
  const expected = platformOutput[process.platform]
  if (!expected) {
    console.error(
      `DSH_NATIVE_PREBUILT=1 is unsupported on ${process.platform}`,
    )
    process.exit(1)
  }
  if (!existsSync(expected)) {
    console.error(
      `DSH_NATIVE_PREBUILT=1 requires ${expected}`,
    )
    process.exit(1)
  }
  console.log(`using prebuilt native collector: ${expected}`)
  process.exit(0)
}

if (process.platform === 'win32' || process.platform === 'linux') {
  const nativePlatform = process.platform === 'win32'
    ? 'windows'
    : 'linux'
  const manifest = path.join('native', nativePlatform, 'Cargo.toml')
  const binaryName = process.platform === 'win32'
    ? 'dsh-computer-history-collector-windows.exe'
    : 'dsh-computer-history-collector-linux'
  const built = path.join(
    'native',
    nativePlatform,
    'target',
    'release',
    binaryName,
  )
  const output = platformOutput[process.platform]

  run(process.env.CARGO ?? 'cargo', [
    'build',
    '--release',
    '--locked',
    '--manifest-path',
    manifest,
  ])
  if (!existsSync(built)) {
    console.error(`cargo succeeded but ${built} does not exist`)
    process.exit(1)
  }

  copyFileSync(built, output)
  if (process.platform === 'linux') {
    chmodSync(output, 0o755)
  }
  console.log(`built ${process.platform} collector: ${output}`)
  process.exit(0)
}

if (process.platform !== 'darwin') {
  console.log(
    `native collector build skipped: unsupported platform ${process.platform}`,
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
const universal = platformOutput.darwin
const identifier =
  'ai.deepseek.dsh.computer-history.collector'

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
