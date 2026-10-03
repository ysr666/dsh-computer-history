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
const CRATE = path.join(REPO, 'native', 'windows')

if (!existsSync(CRATE)) {
  console.log('windows collector: no crate at native/windows - nothing to verify')
  process.exit(0)
}

const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
if (probe.error ?? probe.status !== 0) {
  console.log('windows collector: SKIPPED (no Rust toolchain) - the protocol layer is UNVERIFIED here')
  process.exit(0)
}

const run = spawnSync('cargo', ['test', '--quiet'], { cwd: CRATE, encoding: 'utf8' })
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
if (run.status !== 0) {
  console.error(output)
  console.error('windows collector: the protocol layer failed')
  process.exit(1)
}
const passed = /test result: ok\. (\d+) passed/.exec(output)
console.log(`windows collector: protocol layer ok (${passed ? passed[1] : '?'} tests); UI Automation paths remain unverified without Windows`)
