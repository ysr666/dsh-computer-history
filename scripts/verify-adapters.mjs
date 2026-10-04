// Check that every supported adapter has real-machine evidence in
// docs/adapters.md.
//
//   pnpm verify:adapters
//
// The adapter table is the source of truth for which adapters exist; the
// markdown is the record of what was measured on a real Mac. A missing row, a
// row without a date, or a section without a probe command means the evidence
// claim cannot be checked, so this fails instead of letting the table rot.
import { readFileSync } from 'node:fs'

const README = 'docs/adapters.md'
const TABLE = 'src/shared/constants.ts'

const tableSource = readFileSync(TABLE, 'utf8')
// Full-line comments are removed before anything is parsed: a comment inside a bundleIds array is not
// an id, and this extractor read them as ids twice - once through an apostrophe in prose, once through
// a quote pair spanning a comment - which failed the evidence check for text that is not evidence.
const table = tableSource
  .split('\n')
  .filter(line => !line.trimStart().startsWith('//'))
  .join('\n')
// Entries are indented objects whose bundleIds array spans several lines, so
// the patterns match on content rather than on exact indentation.
const adapterIds = [...table.matchAll(/id: '([a-z0-9-]+)'/g)]
  .map(match => match[1])
const bundleIds = [...table.matchAll(/bundleIds: \[([\s\S]*?)\]/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+)'/g)].map(inner => inner[1]))

const markdown = readFileSync(README, 'utf8')
const problems = []

if (adapterIds.length === 0) {
  problems.push(`${TABLE}: no adapters parsed; the table format changed`)
}

for (const id of adapterIds) {
  const row = new RegExp(`^\\|\\s*\`${id}\`\\s*\\|`, 'm').test(markdown)
  if (!row) {
    problems.push(`${README}: adapter "${id}" has no evidence row`)
    continue
  }
  const section = markdown.split(`### \`${id}\``)[1]
  if (section === undefined) {
    problems.push(`${README}: adapter "${id}" has no section`)
    continue
  }
  if (!/20\d\d-\d\d-\d\d/.test(section)) {
    problems.push(`${README}: adapter "${id}" section has no measurement date`)
  }
  if (!/live-probe|ax-probe|activate/.test(section)) {
    problems.push(`${README}: adapter "${id}" section has no probe command`)
  }
}

for (const bundle of bundleIds) {
  if (!markdown.includes(bundle)) {
    problems.push(`${README}: bundle id ${bundle} is not mentioned`)
  }
}

// A predicate that matches everything and one that matches nothing both look
// like a clean document, so prove this one discriminates before trusting it.
const rowFor = id => new RegExp(`^\\|\\s*\`${id}\`\\s*\\|`, 'm')
{
  if (!rowFor('vscode').test('| `vscode` | notes |')) {
    problems.push('the adapter-row predicate no longer matches a row that exists')
  }
  if (rowFor('vscode').test('| `xcode` | notes |')) {
    problems.push('the adapter-row predicate matches the wrong adapter')
  }
  if (adapterIds.length === 0) {
    problems.push('no adapter ids were read from the table - this guard proves nothing')
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `adapter evidence complete: ${adapterIds.length} adapters, `
  + `${bundleIds.length} bundle ids (${adapterIds.join(', ')})`,
)
