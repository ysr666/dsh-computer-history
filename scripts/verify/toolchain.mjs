// Shared toolchain discovery for the verification helpers.
//
// Mirrors scripts/build-native.mjs so the verification tools compile with the
// same developer directory and SDK as the collector itself, instead of relying
// on whatever `swiftc` happens to be on PATH (the Xcode license check can
// block the shim even when the toolchain works).
import { spawnSync } from 'node:child_process'
import path from 'node:path'

export const developerDirectory =
  process.env.DEVELOPER_DIR
  ?? '/Applications/Xcode.app/Contents/Developer'

export const sdkPath = path.join(
  developerDirectory,
  'Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
)

export const toolchainBin = path.join(
  developerDirectory,
  'Toolchains/XcodeDefault.xctoolchain/usr/bin',
)

export const swiftc = path.join(toolchainBin, 'swiftc')

export function requireMacOS(label) {
  if (process.platform !== 'darwin') {
    console.log(`${label} skipped: macOS only`)
    process.exit(0)
  }
}

export function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
