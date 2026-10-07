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
const RELEASE_WORKFLOW = '.github/workflows/release.yml'
const RELEASE_DOC = 'docs/release.md'

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

// The product journey is intentionally too platform-specific and expensive for
// the portable PR gate, but it is a release invariant. Freeze that split here:
// a workflow refactor must not quietly publish a tag without exercising the
// installed DSH/Chrome/Continue/plugin-lifecycle path.
const releaseWorkflowSource = readFileSync(RELEASE_WORKFLOW, 'utf8')
const releaseDocSource = readFileSync(RELEASE_DOC, 'utf8')
if (!/^\s*runs-on:\s*macos(?:-[^\s#]+)?\s*$/m.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: release job is no longer a macOS job`)
}
if (!/\brun:\s*pnpm --dir extension-editor install --frozen-lockfile\s*$/m.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: Editor Companion dependencies are not installed on a clean release runner`)
}
if (!/\brun:\s*pnpm e2e:product-journey\s*$/m.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: product-journey release gate is missing`)
}
if (!/DSH_CLI=/.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: product journey no longer provisions DSH_CLI`)
}
if (!/PANEL_CHROME=/.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: product journey no longer provisions PANEL_CHROME`)
}
if (!releaseDocSource.includes('pnpm e2e:product-journey')) {
  problems.push(`${RELEASE_DOC}: product-journey release command is undocumented`)
}
if (!releaseDocSource.includes('not part of ordinary `pnpm verify`')) {
  problems.push(`${RELEASE_DOC}: PR-vs-release product-journey boundary is undocumented`)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `ci boundary holds: unverified platforms [${fromFixture.join(', ') || 'none'}] agree in the workflow, `
  + `the conformance fixture and the validation file; matrix runs on [${matrixOs.join(', ')}]; `
  + 'release keeps the macOS product-journey gate',
)

// Unused import guard: keeps the path import meaningful if the file list above ever moves.
void path
