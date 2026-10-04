// One declaration of what the runners do and do not verify, checked in three places.
//
// The workflow header, the adapter fixture's `$unverified` lists and the validation file's CI section all
// state the same boundary in prose, and prose drifts: a platform gets a live row, someone edits the fixture,
// and the workflow header still tells the next reader that nothing has run there. This script freezes the
// boundary as a machine-readable line in each of the three places and fails when they disagree.
//
// The fixture is the source of truth for the *set*: a platform whose `$unverified` list is non-empty has no
// live row, and that is not a comment someone can forget to update - it is the list the conformance suite
// reads.
//
//   node scripts/verify-ci-boundaries.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'

const WORKFLOW = '.github/workflows/collectors.yml'
const VALIDATION = 'docs/validation-three-platforms.md'
const FIXTURE = 'tests/conformance/fixtures/adapters.json'

// The list may now be empty - for the first time all three platforms have a live row - so the markers accept
// an empty tail and the word `none`, which is what a reader would write.
const WORKFLOW_MARKER = /^#\s*unverified-platforms:\s*(.*)$/m
const DOC_MARKER = /<!--\s*unverified-platforms:\s*(.*?)\s*-->/

function listed(value) {
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0 && entry !== 'none')
    .toSorted()
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const fromFixture = Object.entries(fixture.$unverified ?? {})
  .filter(([, reasons]) => Array.isArray(reasons) && reasons.length > 0)
  .map(([platform]) => platform)
  .toSorted()

const workflowSource = readFileSync(WORKFLOW, 'utf8')
const workflowMatch = WORKFLOW_MARKER.exec(workflowSource)
const fromWorkflow = workflowMatch ? listed(workflowMatch[1]) : undefined

const validationSource = readFileSync(VALIDATION, 'utf8')
const validationMatch = DOC_MARKER.exec(validationSource)
const fromValidation = validationMatch ? listed(validationMatch[1]) : undefined

const problems = []
if (!workflowMatch) problems.push(`${WORKFLOW}: no "# unverified-platforms: …" line`)
if (!validationMatch) problems.push(`${VALIDATION}: no "<!-- unverified-platforms: … -->" marker`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
if (fromWorkflow && !same(fromFixture, fromWorkflow)) {
  problems.push(`${WORKFLOW} says [${fromWorkflow}] but the fixture's $unverified lists say [${fromFixture}]`)
}
if (fromValidation && !same(fromFixture, fromValidation)) {
  problems.push(`${VALIDATION} says [${fromValidation}] but the fixture's $unverified lists say [${fromFixture}]`)
}

// The runners the workflow actually uses, so the file cannot quietly lose a platform from its matrix.
const matrixOs = [...workflowSource.matchAll(/^\s*os:\s*\[(.+)\]\s*$/gm)].flatMap(match => listed(match[1]))
for (const runner of ['macos-latest', 'windows-latest', 'ubuntu-latest']) {
  if (!matrixOs.includes(runner)) problems.push(`${WORKFLOW}: matrix no longer runs on ${runner}`)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `ci boundary holds: unverified platforms [${fromFixture.join(', ') || 'none'}] agree in the workflow, `
  + `the conformance fixture and the validation file; matrix runs on [${matrixOs.join(', ')}]`,
)

// Unused import guard: keeps the path import meaningful if the file list above ever moves.
void path
