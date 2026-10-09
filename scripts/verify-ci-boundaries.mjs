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
const PACKAGED_WORKFLOW = '.github/workflows/packaged-alpha.yml'
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

// The complete installed product journey is macOS-specific, so both the
// packaged-client PR matrix and the release workflow must run it against the
// assembled tarball. Never discover Runner-only browser/consent failures only
// after a human authorizes a release.
const packagedWorkflowSource = readFileSync(PACKAGED_WORKFLOW, 'utf8')
if (!packagedWorkflowSource.includes('Full installed-product journey on macOS release candidate')
  || !packagedWorkflowSource.includes('DSH_PRODUCT_TARBALL="$tarball"')
  || !packagedWorkflowSource.includes('pnpm e2e:product-journey')) {
  problems.push(`${PACKAGED_WORKFLOW}: full macOS installed-product PR gate is missing`)
}
if (!packagedWorkflowSource.includes("'scripts/e2e-product-journey.mjs'")
  || !packagedWorkflowSource.includes("'scripts/product-journey-*.mjs'")) {
  problems.push(`${PACKAGED_WORKFLOW}: product journey edits no longer trigger PR validation`)
}
const releaseWorkflowSource = readFileSync(RELEASE_WORKFLOW, 'utf8')
const releaseDocSource = readFileSync(RELEASE_DOC, 'utf8')
if (!/^\s*runs-on:\s*macos(?:-[^\s#]+)?\s*$/m.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: release job is no longer a macOS job`)
}
const editorInstallIsExplicit = /\brun:\s*pnpm --dir extension-editor install --frozen-lockfile\s*$/m
  .test(releaseWorkflowSource)
  || (
    /\brun:\s*pnpm install --frozen-lockfile\s*$/m.test(releaseWorkflowSource)
    && /working-directory:\s*extension-editor\s*$/m.test(releaseWorkflowSource)
  )
if (!editorInstallIsExplicit) {
  problems.push(`${RELEASE_WORKFLOW}: Editor Companion dependencies are not installed on a clean release runner`)
}
if (!/pnpm e2e:product-journey/.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: product-journey release gate is missing`)
}
if (!/DSH_PRODUCT_TARBALL=/.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: product journey no longer reuses the assembled release tarball`)
}
if (!releaseWorkflowSource.includes('echo \'{"private":true}\' > "$root/package.json"')) {
  problems.push(`${RELEASE_WORKFLOW}: DSH CLI bootstrap no longer writes a valid package.json`)
}
// The release product journey must select the same real macOS Chrome binary
// that already passed the packaged-client matrix, not a floating Chrome-for-
// Testing download with different CDP behaviour.
if (!/chrome='\/Applications\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome'/.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: verified macOS Chrome selection is missing`)
}
if (/last-known-good-versions-with-downloads\.json/.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: release Chrome cannot float to a new major version`)
}
// GitHub's gh api can write an HTTP 404 JSON body to stdout even on a failed
// request. Never treat a nonempty suppressed error body as an existing tag.
if (!releaseWorkflowSource.includes('git/matching-refs/tags/$RELEASE_TAG')
  || releaseWorkflowSource.includes('2>/dev/null || true')) {
  problems.push(`${RELEASE_WORKFLOW}: tag discovery can mistake HTTP 404 for an existing immutable tag`)
}
if (!/DSH_CLI=/.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: product journey no longer provisions DSH_CLI`)
}
if (!/PANEL_CHROME=/.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: product journey no longer provisions PANEL_CHROME`)
}
// The first public npm release must use DVR-style explicit SHA publication and
// preserve the three-platform package gate. A git tag push must never bypass
// installed-browser acceptance or produce a different npm/GitHub artifact.
for (const [claim, expression] of [
  ['manual release trigger', /workflow_dispatch:/],
  ['immutable release SHA input', /target_sha:/],
  ['three-platform packaged product gate', /DSH_E2E_VERIFY_CLIENT: '1'/],
  ['tag created after clean-install tests', /tag:\s*\n\s*name: Materialize verified tag\s*\n\s*needs: install/],
  ['npm publish after verified tag', /publish-npm:\s*\n[\s\S]*?needs: tag/],
  ['npm bootstrap must precede any release tag', /release-registry-identity\.mjs inspect 0\.0\.0-bootstrap\.0/],
  ['OIDC publish permission', /id-token: write/],
  ['npm publication without rebuild, pinned to official registry', /npm publish "\$PACKAGE_TARBALL" --registry=https:\/\/registry\.npmjs\.org\/ --access public --provenance --ignore-scripts/],
  ['npm registry byte identity', /release-registry-identity\.mjs wait/],
  ['safe retry requires exact tag identity', /test "\$EXISTING_TAG_SHA" = "\$RELEASE_SHA"/],
  ['safe retry does not overwrite attached GitHub assets', /gh release view "\$RELEASE_TAG" --json assets[\s\S]*?grep -Fxq "\$TARBALL"/],
  ['existing published release requires exact downloaded bytes', /gh release download[\s\S]*?existing GitHub release asset differs/],
  ['GitHub release after npm validation', /publish:\s*\n[\s\S]*?needs: publish-npm/],
]) {
  if (!expression.test(releaseWorkflowSource)) {
    problems.push(`${RELEASE_WORKFLOW}: missing ${claim}`)
  }
}
if (/^\s+tags:\s*\['v\*'\]/m.test(releaseWorkflowSource)) {
  problems.push(`${RELEASE_WORKFLOW}: automatic tag-push publication is forbidden`)
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
  + 'release keeps the macOS product-journey gate on the assembled tarball',
)

// Unused import guard: keeps the path import meaningful if the file list above ever moves.
void path
