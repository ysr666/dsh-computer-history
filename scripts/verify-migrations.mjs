#!/usr/bin/env node
// Enforce the invariants that keep a schema change from silently losing data.
//
//   pnpm verify:migrations
//
// Four rules, each derived from the sources rather than kept in a list somebody
// has to remember to update:
//
//   1. versions are contiguous from 1, and names and checksums are unique;
//   2. every migration file is registered in the runner, and nothing is
//      registered that does not exist;
//   3. a migration that drops or renames a table must declare
//      `rebuildsReferencedTable`, because that flag is what turns foreign keys
//      off around it and runs `PRAGMA foreign_key_check` before the commit -
//      a rebuild without it is exactly where a quiet cascade lives (2.4 found
//      one the hard way);
//   4. the frozen-v1 upgrade test asserts the *latest* version, so a new
//      migration cannot be added without that path covering it.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const REPO = process.cwd()
const DIR = path.join(REPO, 'src', 'host', 'store', 'migrations')
const RUNNER = path.join(REPO, 'src', 'host', 'store', 'migrations.ts')
const UPGRADE_TEST = path.join(REPO, 'tests', 'integration', 'migration-upgrade.spec.ts')

const problems = []
const files = readdirSync(DIR).filter(name => name.endsWith('.ts')).toSorted()

const migrations = files.map((file) => {
  const text = readFileSync(path.join(DIR, file), 'utf8')
  const version = Number(text.match(/version:\s*(\d+)/)?.[1] ?? Number.NaN)
  const name = text.match(/name:\s*'([^']+)'/)?.[1]
  const checksum = text.match(/checksum:\s*'([^']+)'/)?.[1]
  const rebuilds = /rebuildsReferencedTable:\s*true/.test(text)
  const rebuildsTable = /DROP TABLE|RENAME TO/i.test(text)
  return { file, text, version, name, checksum, rebuilds, rebuildsTable }
})

// 1. contiguous versions, unique names and checksums
for (const [index, migration] of migrations.entries()) {
  if (migration.version !== index + 1) {
    problems.push(
      `${migration.file}: version ${migration.version} where ${index + 1} was expected`,
    )
  }
}
for (const key of ['name', 'checksum']) {
  const seen = new Map()
  for (const migration of migrations) {
    const value = migration[key]
    if (value === undefined) {
      problems.push(`${migration.file}: no ${key}`)
      continue
    }
    if (seen.has(value)) {
      problems.push(`${migration.file} and ${seen.get(value)} share the ${key} "${value}"`)
    }
    seen.set(value, migration.file)
  }
}

// 2. the runner registers every file, and only files that exist
const runner = readFileSync(RUNNER, 'utf8')
const registered = [...runner.matchAll(/migration(\d{4})/g)].map(match => match[1])
for (const migration of migrations) {
  const digits = migration.file.slice(0, 4)
  const count = registered.filter(entry => entry === digits).length
  if (count === 0) problems.push(`${migration.file} is not registered in the runner`)
}
for (const digits of new Set(registered)) {
  if (!files.some(file => file.startsWith(digits))) {
    problems.push(`the runner registers migration${digits}, which has no file`)
  }
}

// 3. a rebuild must opt into the integrity path
for (const migration of migrations) {
  if (migration.rebuildsTable && !migration.rebuilds) {
    problems.push(
      `${migration.file} drops or renames a table without rebuildsReferencedTable, `
      + 'so the runner would commit it without a foreign_key_check',
    )
  }
}
if (!runner.includes('foreign_key_check')) {
  problems.push('the runner no longer checks foreign keys - the rebuild path proves nothing')
}

// 4. the upgrade test asserts the latest version
// Asserting is not mentioning: the first version of this rule accepted a line
// that *sets* user_version. It must appear inside an expectation, or the test
// proves nothing about which schema the upgrade produced.
const upgrade = readFileSync(UPGRADE_TEST, 'utf8')
const assertsVersion = /expect\([\s\S]{0,120}?user_version/.test(upgrade)
if (!assertsVersion) {
  problems.push(
    'the frozen-v1 upgrade test does not assert PRAGMA user_version, so a new '
    + 'migration can be added without that path covering it',
  )
}

// --- self-checks -----------------------------------------------------------
const versionOf = text => Number(text.match(/version:\s*(\d+)/)?.[1] ?? Number.NaN)
const rebuildsTable = text => /DROP TABLE|RENAME TO/i.test(text)

{
  if (versionOf('  version: 3,') !== 3) {
    problems.push('the version reader no longer reads a version - this guard proves nothing')
  }
  if (!Number.isNaN(versionOf('  name: 3,'))) {
    problems.push('the version reader reads a version out of something else')
  }
  if (!rebuildsTable('DROP TABLE episodes;')) {
    problems.push('the rebuild detector no longer sees a DROP TABLE')
  }
  if (rebuildsTable('CREATE TABLE episodes (id TEXT);')) {
    problems.push('the rebuild detector flags a migration that only creates')
  }
  if (migrations.length === 0) {
    problems.push('no migration files were read - this guard proves nothing')
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

const latest = migrations.at(-1)
console.log(
  `migration invariants hold: ${migrations.length} migrations, versions 1..${latest.version}, `
  + `${migrations.filter(m => m.rebuilds).length} rebuilds behind an integrity check`,
)
