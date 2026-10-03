#!/usr/bin/env node
// User-facing documents must have a Chinese sibling, and the translation must not fall behind.
//
//   pnpm verify:docs
//
// The rule: anything a user reads has a Chinese version; anything an engineer reads stays in one
// language. The list is explicit rather than discovered, because whether a document is user-facing is
// a judgement and a rule that guesses would either miss documents or demand translations of ADRs.
//
// Two checks: a Chinese sibling exists, and the English side has not changed more recently than its
// translation. A translation that quietly falls behind is worse than none: it is wrong without looking
// wrong.
//
// Two things this file learned the hard way, both kept as comments because both cost a round:
//   - "the pair was last changed in the same commit" cannot be satisfied by a first translation (the
//     original necessarily predates it), so drift means *the English side moved last*;
//   - the logic stays in plain JavaScript on purpose. scripts/*.mjs run under node with no TypeScript
//     loader, so importing the typed module this briefly lived in made the guard unable to run at all.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const USER_FACING = [
  'README.md',
  'SECURITY.md',
  'docs/companion.md',
  'docs/editor-companion.md',
  'docs/adapters.md',
  'docs/remote-models.md',
]

export function siblingOf(relative) {
  return relative.endsWith('.md') ? `${relative.slice(0, -3)}.zh.md` : `${relative}.zh.md`
}

/** When a path was last changed, as an epoch second, or undefined when git cannot say. */
export function lastChangeSeconds(repoDir, relative) {
  try {
    const value = execFileSync('git', ['log', '-1', '--format=%ct', '--', relative], {
      cwd: repoDir, encoding: 'utf8',
    }).trim()
    return value ? Number(value) : undefined
  } catch {
    return undefined
  }
}

export function checkDocs({ repoDir = REPO, documents = USER_FACING, changedAt = lastChangeSeconds } = {}) {
  const problems = []
  for (const document of documents) {
    const zh = siblingOf(document)
    if (!existsSync(path.join(repoDir, document))) {
      problems.push(`${document}: listed as user-facing but missing`)
      continue
    }
    if (!existsSync(path.join(repoDir, zh))) {
      problems.push(`${document}: no Chinese sibling (${zh})`)
      continue
    }
    const enAt = changedAt(repoDir, document)
    const zhAt = changedAt(repoDir, zh)
    if (enAt !== undefined && zhAt !== undefined && enAt > zhAt) {
      problems.push(`${document} was changed after ${zh} - the translation has fallen behind`)
    }
  }
  return problems
}

// --- self-checks: the guard must be able to fail -------------------------------------------
{
  const selfProblems = []
  if (siblingOf('README.md') !== 'README.zh.md') selfProblems.push('sibling naming is wrong')
  if (!USER_FACING.includes('README.md')) selfProblems.push('the list lost a document it had')
  if (checkDocs({ documents: ['docs/does-not-exist.md'] }).length === 0) {
    selfProblems.push('a missing document is not reported - this guard proves nothing')
  }
  // A file that exists, with a clock that knows nothing: an unknown clock must not be read as drift,
  // or a fresh clone without history would fail. (The first version of this case used a file that does
  // not exist, so it tripped the missing-file check instead and blocked the guard with its own
  // self-check.)
  if (checkDocs({ documents: ['README.md'], changedAt: () => undefined }).length !== 0) {
    selfProblems.push('an unknown clock reports drift - it would fail on a fresh clone')
  }
  if (selfProblems.length > 0) {
    console.error(selfProblems.join('\n'))
    process.exit(1)
  }
}

const problems = checkDocs()
if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`user-facing documents and their Chinese siblings agree: ${USER_FACING.length} checked`)
