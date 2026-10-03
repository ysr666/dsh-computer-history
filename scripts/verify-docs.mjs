#!/usr/bin/env node
// User-facing documents must have a Chinese sibling, and the pair must not drift.
//
//   pnpm verify:docs
//
// The rule this repository adopted with the three-platform plan: anything a user reads has a
// Chinese version; anything an engineer reads stays in one language. The list below is explicit
// rather than discovered, because "is this document user-facing" is a judgement and a rule that
// guesses would either miss documents or demand translations of ADRs.
//
// Two checks, and the second is the one that matters:
//   1. every listed document has <name>.zh.md;
//   2. the pair was last changed in the same commit. A translation that quietly falls behind is
//      worse than no translation, because it is wrong without looking wrong.
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

/** The commit that last touched a path, or undefined when git cannot say. */
export function lastCommit(repoDir, relative) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%H', '--', relative], {
      cwd: repoDir, encoding: 'utf8',
    }).trim() || undefined
  } catch {
    return undefined
  }
}

export function checkDocs({ repoDir = REPO, documents = USER_FACING } = {}) {
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
    const [enCommit, zhCommit] = [lastCommit(repoDir, document), lastCommit(repoDir, zh)]
    if (enCommit && zhCommit && enCommit !== zhCommit) {
      problems.push(
        `${document} and ${zh} were last changed in different commits - the translation has fallen behind`,
      )
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
