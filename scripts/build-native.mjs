import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'

if (
  process.env.DSH_NATIVE_PREBUILT === '1'
  || process.env.DSH_NATIVE_BUILD_SKIP === '1'
) {
  console.log('native collector build skipped: prebuilt native artifacts supplied')
  process.exit(0)
}

const outputDir = 'bin'
mkdirSync(outputDir, { recursive: true })

function run(command, args, options = {}) {
  const result = spawnSync(
    command,
    args,
    { stdio: 'inherit', ...options },
  )
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function gitCommit() {
  return process.env.GITHUB_SHA
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function writeProvenance(platform, binary, arch) {
  const provenance = {
    schema: 1,
    platform,
    arch,
    binary: path.posix.join('bin', path.basename(binary)),
    sha256: sha256(binary),
    commit: gitCommit(),
    builtOn: process.platform,
    runnerOs: process.env.RUNNER_OS ?? null,
    runnerArch: process.env.RUNNER_ARCH ?? null,
  }
  const sidecar = `${binary}.provenance.json`
  writeFileSync(sidecar, JSON.stringify(provenance, null, 2) + '\n')
  console.log(`wrote native provenance: ${sidecar}`)
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
  const universal = path.join(
    outputDir,
    'dsh-computer-history-collector',
  )
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
  chmodSync(universal, 0o755)
  writeProvenance('darwin', universal, 'universal')

  console.log(
    adHoc
      ? `built and signed the universal macOS collector ad-hoc (${identifier})`
      : `built and signed the universal macOS collector with a Developer ID (${identifier})`,
  )
}

function buildRust(platform, manifest, builtName, packagedName) {
  run('cargo', [
    'build',
    '--release',
    '--manifest-path', manifest,
  ])
  const source = path.join(
    path.dirname(manifest),
    'target',
    'release',
    builtName,
  )
  const output = path.join(outputDir, packagedName)
  copyFileSync(source, output)
  if (process.platform !== 'win32') chmodSync(output, 0o755)
  writeProvenance(platform, output, process.arch)
  console.log(`built ${platform} collector: ${output}`)
}

switch (process.platform) {
  case 'darwin':
    buildMacos()
    break
  case 'win32':
    buildRust(
      'win32',
      'native/windows/Cargo.toml',
      'dsh-computer-history-collector-windows.exe',
      'dsh-computer-history-collector-windows.exe',
    )
    break
  case 'linux':
    buildRust(
      'linux',
      'native/linux/Cargo.toml',
      'dsh-computer-history-collector-linux',
      'dsh-computer-history-collector-linux',
    )
    break
  default:
    console.error(`native collector build unsupported on ${process.platform}`)
    process.exit(1)
}
