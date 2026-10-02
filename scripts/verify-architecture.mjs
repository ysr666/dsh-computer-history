#!/usr/bin/env node
// Enforce two structural rules that a compiler cannot see.
//
//   pnpm verify:architecture
//
// 1. `src/shared` is the contract layer: the Host, the client and the native
//    side all depend on it, so an import from it back into `host`, `client` or
//    an extension is a cycle in the dependency graph, not a style preference.
// 2. An export nobody reads is either a feature that was never finished or a
//    leftover; both are worth a deliberate decision rather than silence.
//
// Both checks carry a discriminating self-check: a rule that matches nothing
// looks exactly like a codebase that satisfies it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const REPO = process.cwd()
const SHARED = path.join(REPO, 'src', 'shared')
const problems = []

function sourceFiles(root, extensions = ['.ts']) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'lib') continue
        walk(full)
      } else if (extensions.some(extension => entry.endsWith(extension))) {
        found.push(full)
      }
    }
  }
  walk(root)
  return found
}

/** Imports that would point from the contract layer back into an implementation. */
const LAYER_ESCAPE = /from\s+['"][^'"]*\/(host|client|extension|extension-editor)\/[^'"]*['"]/

const sharedFiles = sourceFiles(SHARED)
const escapes = []
for (const file of sharedFiles) {
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((line, index) => {
    if (LAYER_ESCAPE.test(line)) {
      escapes.push(`${path.relative(REPO, file)}:${index + 1}: ${line.trim()}`)
    }
  })
}

/** Names the contract layer exports, and where they are read. */
const EXPORT = /^export\s+(?:async\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm
const exported = new Map()
for (const file of sharedFiles) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(EXPORT)) {
    if (!exported.has(match[1])) exported.set(match[1], path.relative(REPO, file))
  }
}

const consumers = [
  ...sourceFiles(path.join(REPO, 'src'), ['.ts']),
  ...sourceFiles(path.join(REPO, 'tests'), ['.ts']),
  ...sourceFiles(path.join(REPO, 'extension'), ['.js']),
  ...sourceFiles(path.join(REPO, 'extension-editor'), ['.ts']),
  ...sourceFiles(path.join(REPO, 'scripts'), ['.mjs', '.ts']),
].filter(file =>
  !file.startsWith(SHARED)
  // The guard's own source contains the synthetic names its self-checks use, so
  // counting it as a consumer would make the dead-export probe always "used".
  && path.resolve(file) !== path.resolve(import.meta.filename),
)

// Dead means referenced **nowhere**, including inside the layer. A name that only
// ever appears in its own declaration is a leftover; a name that appears in a
// union the layer exports is doing work, even if no consumer spells it out. The
// first version of this rule counted only consumers and therefore wanted to
// delete seven live protocol types - the check was too crude, not the code.
const allSources = [...sharedFiles, ...consumers]
const corpus = allSources.map(file => readFileSync(file, 'utf8')).join('\n')
const unread = []
for (const [name, declaredIn] of exported) {
  const occurrences = corpus.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0
  if (occurrences <= 1) {
    unread.push(`${name} (exported by ${declaredIn}, referenced nowhere)`)
  }
}

// --- self-checks: both rules must still discriminate -----------------------
{
  const goodEscape = "import x from '../host/store/index.js'"
  const fine = "import type { EpisodeId } from './ids.js'"
  if (!LAYER_ESCAPE.test(goodEscape)) {
    problems.push('the layering rule no longer catches an escape - this guard proves nothing')
  }
  if (LAYER_ESCAPE.test(fine)) {
    problems.push('the layering rule flags an import that stays inside the layer')
  }
  if (sharedFiles.length === 0) {
    problems.push('no files were read in src/shared - this guard proves nothing')
  }
  if (exported.size === 0) {
    problems.push('no exports were read in src/shared - this guard proves nothing')
  }
  const occurrences = name =>
    corpus.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0
  if (occurrences('ZZZ_NAME_THAT_APPEARS_NOWHERE') > 1) {
    problems.push('the dead-export check counts a name that appears nowhere as used')
  }
  if (occurrences('EpisodeId') <= 1) {
    problems.push('the dead-export check counts a name that is used as dead')
  }
}

if (escapes.length > 0) {
  problems.push(
    'src/shared must not import an implementation layer:\n' + escapes.join('\n'),
  )
}
if (unread.length > 0) {
  problems.push(
    'these contract exports are read nowhere:\n'
    + unread.map(entry => `  ${entry}`).join('\n'),
  )
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `architecture holds: ${sharedFiles.length} contract files, ${exported.size} `
  + 'exports all read, no import escapes the layer',
)
