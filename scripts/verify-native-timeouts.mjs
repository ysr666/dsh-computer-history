#!/usr/bin/env node
// Every accessibility read in the native collectors must be bounded.
//
//   pnpm verify:native-timeouts
//
// An application that never responds is an ordinary Tuesday, and the only thing
// that keeps it from hanging the collector is AXUIElementSetMessagingTimeout being
// applied to the element before it is read. Nothing enforced that: a new read site
// added without a timeout would hang capture exactly where this matters, and every
// existing test would stay green - the same shape of gap as a guard that cannot fail.
//
// The rule is deliberately the strongest one a text check can prove: **every Swift
// file that reads an accessibility attribute must also call the timeout helper**. The
// sharper property - that the element a given read receives had its timeout set -
// depends on which object flows into the call, and `AXUIElementSetMessagingTimeout`
// sets it on the element, so a helper that receives an element from a caller which
// bounded it is correct even though its own body never calls the helper. A guard that
// insisted otherwise would fail on correct code.
//
// The Windows collector has the same rule in UIA's vocabulary: a file that performs a
// UI Automation read must also set the automation object's connection and transaction
// timeouts (IUIAutomation2), because the host stops the collector when a configure
// acknowledgement is missed, and an unresponsive provider is how that happens.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const REPO = process.cwd()
const ROOT = path.join(REPO, 'native', 'macos', 'Sources')
const HELPER = 'applyMessagingTimeout'
const READ = /AXUIElementCopyAttributeValue\s*\(/g

const RUST_ROOT = path.join(REPO, 'native', 'windows', 'src')
const RUST_READ = /(GetFocusedElement|CurrentIsPassword|CurrentControlType|SHGetPropertyStoreForWindow)\b/g
const RUST_BOUNDS = ['SetConnectionTimeout', 'SetTransactionTimeout']

const problems = []

function sourceFiles(dir, extension) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full, extension))
    else if (entry.endsWith(extension)) found.push(full)
  }
  return found
}

const files = sourceFiles(ROOT, '.swift')
let readSites = 0
let boundingFiles = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  READ.lastIndex = 0
  const reads = [...text.matchAll(READ)].length
  if (reads === 0) continue
  readSites += reads
  if (!text.includes(HELPER)) {
    problems.push(
      `${path.relative(REPO, file)} reads ${reads} accessibility attribute(s) but never `
      + `calls ${HELPER} - nothing in that file bounds an unresponsive application`,
    )
  } else {
    boundingFiles += 1
  }
}

const rustFiles = sourceFiles(RUST_ROOT, '.rs')
let rustReadSites = 0
let rustBoundingFiles = 0
for (const file of rustFiles) {
  const text = readFileSync(file, 'utf8')
  RUST_READ.lastIndex = 0
  const reads = [...text.matchAll(RUST_READ)].length
  if (reads === 0) continue
  rustReadSites += reads
  const missing = RUST_BOUNDS.filter(token => !text.includes(token))
  if (missing.length > 0) {
    problems.push(
      `${path.relative(REPO, file)} performs ${reads} UI Automation read(s) but never sets `
      + `${missing.join(' / ')} - an unresponsive provider would hang the heartbeat`,
    )
  } else {
    rustBoundingFiles += 1
  }
}

// --- self-checks: the detector must still recognise what it catches -----------
{
  READ.lastIndex = 0
  if (!READ.test('let value = AXUIElementCopyAttributeValue(element, key, &out)')) {
    problems.push('the read detector no longer matches a read - this guard proves nothing')
  }
  READ.lastIndex = 0
  if (READ.test('AXUIElementCopyAttributeValues(element, key, 0, 1, &out)')) {
    problems.push('the read detector matches a different API')
  }
  if (files.length === 0) {
    problems.push('no Swift files were read - this guard proves nothing')
  }
  if (readSites === 0) {
    problems.push('no accessibility reads were found at all - this guard proves nothing')
  }
  RUST_READ.lastIndex = 0
  if (!RUST_READ.test('let element = automation.GetFocusedElement()')) {
    problems.push('the Rust read detector no longer matches a UIA read - this guard proves nothing')
  }
  RUST_READ.lastIndex = 0
  if (RUST_READ.test('let title = window_text(hwnd)')) {
    problems.push('the Rust read detector matches a call that is not a UIA read')
  }
  if (rustFiles.length === 0) {
    problems.push('no Rust collector files were read - this guard proves nothing')
  }
  if (rustReadSites === 0) {
    problems.push('no UI Automation reads were found at all - this guard proves nothing')
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `native accessibility reads are bounded: ${readSites} Swift read(s) across ${files.length} `
  + `file(s) (${boundingFiles} bounded) and ${rustReadSites} UIA read(s) across ${rustFiles.length} `
  + `Rust file(s) (${rustBoundingFiles} bounded)`,
)
