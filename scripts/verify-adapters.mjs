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
// Entries are indented objects whose bundleIds array spans several lines, so
// the patterns match on content rather than on exact indentation.
const adapterIds = [...tableSource.matchAll(/id: '([a-z0-9-]+)'/g)]
  .map(match => match[1])
const bundleIds = [...tableSource.matchAll(/bundleIds: \[([\s\S]*?)\]/g)]
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

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `adapter evidence complete: ${adapterIds.length} adapters, `
  + `${bundleIds.length} bundle ids (${adapterIds.join(', ')})`,
)
