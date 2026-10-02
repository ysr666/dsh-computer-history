// Build (or remove) the synthetic fixture application used by the adapter and
// privacy recipes.
//
//   node scripts/verify/fixtures/build-fixture.mjs --bundle <id> [--clean]
//
// The bundle id must be given explicitly, and it must be one of the Phase 1
// supported ids: the collector only observes applications it has an adapter
// for. A fixture that claims a real bundle id shadows nothing while it lives
// in bin/fixtures, but it MUST NOT be left around — LaunchServices would see
// two bundles with the same identifier. Always finish with --clean.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  requireMacOS,
  run,
  sdkPath,
  swiftc,
} from '../toolchain.mjs'

requireMacOS('fixture build')

const SUPPORTED = [
  'com.microsoft.VSCode',
  'com.todesktop.230313mzl4w4u92',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.apple.Preview',
  'com.apple.finder',
]

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const fixtureRoot = 'bin/fixtures'
const appPath = path.join(fixtureRoot, 'DSHFixture.app')

if (process.argv.includes('--clean')) {
  rmSync(appPath, { recursive: true, force: true })
  console.log(`removed ${appPath}`)
  process.exit(0)
}

const bundleId = argument('--bundle')
if (!bundleId) {
  console.error(
    'missing --bundle: pass one of the Phase 1 supported ids:\n  '
    + SUPPORTED.join('\n  '),
  )
  process.exit(2)
}
if (!SUPPORTED.includes(bundleId)) {
  console.error(
    `${bundleId} has no Phase 1 adapter, so the collector would ignore the `
    + 'fixture. Supported ids:\n  ' + SUPPORTED.join('\n  '),
  )
  process.exit(2)
}

const executable = path.join(appPath, 'Contents/MacOS/DSHFixture')
const infoPlist = path.join(appPath, 'Contents/Info.plist')
mkdirSync(path.dirname(executable), { recursive: true })

run(swiftc, [
  '-O',
  '-sdk', sdkPath,
  'scripts/verify/fixtures/fixture-app.swift',
  '-o', executable,
  '-framework', 'AppKit',
])

writeFileSync(infoPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleName</key><string>DSH Verification Fixture</string>
<key>CFBundleExecutable</key><string>DSHFixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`, 'utf8')

if (!existsSync(executable)) {
  console.error('fixture executable was not produced')
  process.exit(1)
}
run('/usr/bin/codesign', ['--force', '--sign', '-', appPath])

console.log(
  `fixture ready: ${appPath} (bundle ${bundleId})\n`
  + `run: ${executable} <secure|plain|hung> <represented-path>\n`
  + `cleanup: node scripts/verify/fixtures/build-fixture.mjs --clean`,
)
