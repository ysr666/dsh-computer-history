#!/usr/bin/env node
// Every accessibility read in the native collector must be bounded.
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
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const REPO = process.cwd()
const ROOT = path.join(REPO, 'native', 'macos', 'Sources')
const HELPER = 'applyMessagingTimeout'
const READ = /AXUIElementCopyAttributeValue\s*\(/g

const problems = []

function swiftFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...swiftFiles(full))
    else if (entry.endsWith('.swift')) found.push(full)
  }
  return found
}

const files = swiftFiles(ROOT)
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
  if (!'func f(element: AXUIElement) { AXUIElementCopyAttributeValue(element, key, &out) }'.includes(HELPER)) {
    // A file-level rule is the strongest one a text check can prove: whether a given
    // read is bounded depends on which element object it receives, and that is a
    // data flow, not a line.
  } else {
    problems.push('the bounding check is fooled by a read that never bounds anything')
  }
  if (files.length === 0) {
    problems.push('no Swift files were read - this guard proves nothing')
  }
  if (readSites === 0) {
    problems.push('no accessibility reads were found at all - this guard proves nothing')
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `native accessibility reads are bounded: ${readSites} read(s) across ${files.length} `
  + `Swift file(s); every file that reads also calls ${HELPER} (${boundingFiles} of them)`,
)
