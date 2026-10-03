#!/usr/bin/env node
// The Windows collector's protocol layer, tested wherever Rust exists.
//
//   pnpm verify:collector-windows
//
// What this checks: the crate compiles and its message layer matches docs/collector-protocol.md,
// including the property that the observation shape has no field for content.
//
// What it does NOT check, and says so out loud: anything that needs UI Automation. A machine without
// Windows cannot observe a window, and a green run here is not evidence for the Windows rows in
// tests/conformance/fixtures/adapters.json. Those are marked unverified until a real machine produces
// them - the recipe is in docs/validation-three-platforms.md.
//
// A missing Rust toolchain is a skip, printed as a skip. Reporting a pass without running anything is
// the failure mode this repository has been bitten by most often.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The message layer lives once, in the shared crate, and both platform crates depend on it. Testing the
// shared crate is what makes "the same fields on every platform" checkable; testing the platform crate is
// what makes its own module compile.
const CRATES = [
  ['collector-protocol', path.join(REPO, 'native', 'collector-protocol')],
  ['windows', path.join(REPO, 'native', 'windows')],
  ['linux', path.join(REPO, 'native', 'linux')],
].filter(([, dir]) => existsSync(dir))

if (CRATES.length === 0) {
  console.log('rust collectors: no crates under native/ - nothing to verify')
  process.exit(0)
}

const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
if (probe.error ?? probe.status !== 0) {
  console.log('windows collector: SKIPPED (no Rust toolchain) - the protocol layer is UNVERIFIED here')
  process.exit(0)
}

let total = 0
for (const [name, dir] of CRATES) {
  const run = spawnSync('cargo', ['test', '--quiet'], { cwd: dir, encoding: 'utf8' })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  if (run.status !== 0) {
    console.error(output)
    console.error(`rust collector (${name}): failed`)
    process.exit(1)
  }
  const counts = [...output.matchAll(/test result: ok\. (\d+) passed/g)]
  total += counts.reduce((sum, match) => sum + Number(match[1]), 0)
}
console.log(
  `rust collectors: ${total} tests passed across ${CRATES.map(([name]) => name).join(', ')}; ` +
  'UI Automation and AT-SPI paths remain unverified without their platforms',
)
