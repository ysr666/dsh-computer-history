import {
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

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
// A distribution build must be signed with a Developer ID and notarized: an ad-hoc signature is fine on the
// machine that built it and blocked by Gatekeeper everywhere else, and until now the log said "signed" for
// both. `DSH_COMPUTER_HISTORY_REQUIRE_DISTRIBUTION=1` is what a release passes, so an unnotarized artifact
// cannot leave by accident.
const requireDistribution = process.env.DSH_COMPUTER_HISTORY_REQUIRE_DISTRIBUTION === '1'
const notaryProfile = process.env.DSH_COMPUTER_HISTORY_NOTARY_PROFILE
if (requireDistribution && adHoc) {
  console.error(
    'DSH_COMPUTER_HISTORY_REQUIRE_DISTRIBUTION=1 but no signing identity was given: set '
    + 'DSH_COMPUTER_HISTORY_CODESIGN_IDENTITY to a "Developer ID Application" identity. An ad-hoc signature '
    + 'is refused for a distribution build because Gatekeeper blocks it on every other machine.',
  )
  process.exit(1)
}
if (requireDistribution && notaryProfile === undefined) {
  console.error(
    'DSH_COMPUTER_HISTORY_REQUIRE_DISTRIBUTION=1 but DSH_COMPUTER_HISTORY_NOTARY_PROFILE is not set: a '
    + 'distribution build has to be notarized (create a notarytool keychain profile first).',
  )
  process.exit(1)
}
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

if (!adHoc && notaryProfile !== undefined) {
  // A bare executable cannot be stapled - staple applies to .app, .dmg and .pkg - so the notarization ticket
  // stays online and Gatekeeper checks it when the binary first runs. The zip is what notarytool submits.
  const zip = path.join(outputDir, 'dsh-computer-history-collector-notarize.zip')
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', universal, zip])
  const submission = run('/usr/bin/xcrun', [
    'notarytool', 'submit', zip, '--keychain-profile', notaryProfile, '--wait',
  ])
  console.log(String(submission).slice(-400))
  run('/usr/bin/rm', ['-f', zip])
  const gatekeeper = run('/usr/bin/spctl', ['-a', '-vvv', universal])
  console.log(String(gatekeeper).slice(-200))
}

console.log(
  adHoc
    ? `built and signed the universal macOS collector ad-hoc (${identifier}) - fine for this machine, not for distribution`
    : `built and signed the universal macOS collector with a Developer ID (${identifier})`
    + (notaryProfile === undefined ? ' - not notarized' : ' - notarized'),
)
