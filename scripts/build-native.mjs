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
const macOutput = path.join(outputDir, 'dsh-computer-history-collector')
const windowsOutput = path.join(outputDir, 'dsh-computer-history-collector-windows.exe')
const linuxOutput = path.join(outputDir, 'dsh-computer-history-collector-linux')

mkdirSync(outputDir, { recursive: true })

if (process.env.DSH_NATIVE_PREBUILT === '1') {
  const required = [macOutput, windowsOutput, linuxOutput]
  const missing = required.filter(file => !existsSync(file))
  if (missing.length > 0) {
    console.error(
      'DSH_NATIVE_PREBUILT=1 but assembled collectors are missing: '
      + missing.join(', '),
    )
    process.exit(1)
  }
  console.log('using prebuilt native collectors: ' + required.join(', '))
  process.exit(0)
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function buildMacos() {
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
    macOutput,
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
  signArgs.push(macOutput)

  run(codesign, signArgs)
  run(codesign, [
    '--verify',
    '--strict',
    '--verbose=2',
    macOutput,
  ])

  console.log(
    adHoc
      ? `built universal macOS collector with ad-hoc signature (${identifier})`
      : `built universal macOS collector with Developer ID (${identifier})`,
  )
}

function buildWindows() {
  run('cargo', [
    'build',
    '--release',
    '--manifest-path',
    'native/windows/Cargo.toml',
  ])
  const source = path.join(
    'native', 'windows', 'target', 'release',
    'dsh-computer-history-collector-windows.exe',
  )
  copyFileSync(source, windowsOutput)
  console.log(`built Windows collector -> ${windowsOutput}`)
}

function buildLinux() {
  run('cargo', [
    'build',
    '--release',
    '--manifest-path',
    'native/linux/Cargo.toml',
  ])
  const source = path.join(
    'native', 'linux', 'target', 'release',
    'dsh-computer-history-collector-linux',
  )
  copyFileSync(source, linuxOutput)
  chmodSync(linuxOutput, 0o755)
  console.log(`built Linux collector -> ${linuxOutput}`)
}

switch (process.platform) {
  case 'darwin':
    buildMacos()
    break
  case 'win32':
    buildWindows()
    break
  case 'linux':
    buildLinux()
    break
  default:
    console.error(`native collector build is unsupported on ${process.platform}`)
    process.exit(2)
}
