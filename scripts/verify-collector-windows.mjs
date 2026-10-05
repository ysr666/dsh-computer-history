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
import { readdirSync, readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Every .rs file below a directory, skipping build output. */
function sourceFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(full))
    else if (entry.name.endsWith('.rs')) found.push(readFileSync(full, 'utf8'))
  }
  return found
}
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
// The document is this layer's contract, so it has to describe the layer the crate actually speaks. The
// header of this file claimed that agreement before there was any mechanism behind it - an adversarial pass
// renamed a message in docs/collector-protocol.md and every check stayed green. Both directions are checked
// now: nothing spoken that the document does not mention, nothing documented that the layer cannot speak.
const protocolDoc = readFileSync(path.join(REPO, 'docs', 'collector-protocol.md'), 'utf8')
const protocolSources = sourceFiles(path.join(REPO, 'native', 'collector-protocol', 'src'))
const spoken = new Set(
  [...protocolSources.join('\n').matchAll(/message_type:\s*"([a-z][a-z-]*)"/g)].map(match => match[1]),
)
const documented = new Set(
  [...protocolDoc.matchAll(/"type"\s*:\s*"([a-z][a-z-]*)"/g)].map(match => match[1]),
)
if (spoken.size === 0 || documented.size === 0) {
  console.error(spoken.size === 0
    ? 'the message layer exposes no message_type at all - the extraction broke and this check proves nothing'
    : 'docs/collector-protocol.md names no message type at all - either it stopped documenting them or the extraction broke')
  process.exit(1)
}
const undocumented = [...spoken].filter(name => !new RegExp(`\\b${name}\\b`).test(protocolDoc))
const invented = [...documented].filter(name => !spoken.has(name))
if (undocumented.length || invented.length) {
  for (const name of undocumented) {
    console.error(`the message layer speaks "${name}" and docs/collector-protocol.md never mentions it`)
  }
  for (const name of invented) {
    console.error(`docs/collector-protocol.md documents "${name}" and the message layer cannot speak it`)
  }
  process.exit(1)
}

console.log(
  `rust collectors: ${total} tests passed across ${CRATES.map(([name]) => name).join(', ')}; ` +
  'these tests do not exercise UI Automation or AT-SPI - only a live run counts, and ' +
  'docs/validation-three-platforms.md records which platforms have one; the message names it speaks\n'
  + `and ${documented.size} documented message type(s) agree with docs/collector-protocol.md`,
)
