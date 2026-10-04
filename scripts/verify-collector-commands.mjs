// One collector command layer, and nobody scanning the raw line.
//
//   pnpm verify:collector-commands
//
// Two defects came from collectors reading the host's command JSON themselves:
//
//   * the Windows collector carried a hand-written JSON scanner (~250 lines) whose escaping and number
//     handling had to be reviewed by reading it, and which the serde migration replaced;
//   * the Linux collector scanned for the *substring* `"configure"`, so
//     `{"type":"pause","note":"a \"configure\" b"}` made it acknowledge `configured revision 0` (the host
//     then sees a revision mismatch and degrades), a revision longer than a few digits was truncated to
//     nothing, and `pause`/`resume` were ignored outright. All three were found by driving the real
//     binary and are now gone because the parsing lives in one place.
//
// The rules:
//   1. exactly one function decides what a line means, and it lives in the shared crate;
//   2. no other Rust collector source names a command keyword as a string literal - the check is on the
//      **literal**, quote-agnostic, so it cannot be fooled by re-spelling the comparison (the previous
//      version listed spellings and missed `line.contains('"configure"')`).
//
// Known limits, stated rather than implied: this reads Rust sources only (the Swift collector decodes with
// `Codable`, which is the structure this guard is trying to protect), a scan hidden behind an indirected
// constant, in a non-source file, or under `target/` is out of reach, and the rule is textual - it says
// "no keyword literal here", not "this code cannot parse JSON".
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const NATIVE = path.join(REPO, 'native')
const SHARED = path.join(NATIVE, 'collector-protocol', 'src', 'command.rs')

/**
 * The command keywords, as a string literal in any quoting style.
 *
 * The optional backslashes are what a Rust source file contains when the quotes are escaped
 * (`line.contains("\"configure\"")`): the first version of this rule required the closing quote to follow
 * the keyword immediately, so it matched the plain spelling and missed both escaped ones - the gap an
 * adversarial re-run found by injecting each spelling.
 */
const COMMAND_LITERAL = /\\?(['"])(configure|revision|shutdown|pause|resume)\\?\1/
const PARSE_COMMAND = /pub fn parse_command/g

/**
 * The code a collector actually ships: line comments removed, and the test module cut away.
 *
 * Tests legitimately build wire strings (`"{\"type\":\"configured\",\"revision\":3}"`), and a keyword
 * quoted inside prose is not a scan either - both would otherwise be reported as hand-written parsing.
 */
function codeOnly(text) {
  const shipped = text.split('\n#[cfg(test)]')[0]
  return shipped
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n')
}

/** Every Rust source file under native/, skipping build output. */
function sourceFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'target' || entry === 'node_modules') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full))
    else if (entry.endsWith('.rs')) found.push(full)
  }
  return found
}

const problems = []
const files = sourceFiles(NATIVE)
if (files.length === 0) {
  problems.push(`${NATIVE}: no Rust sources found - this guard proves nothing`)
}

const sources = new Map(files.map(file => [file, readFileSync(file, 'utf8')]))

// Rule 1: one decider, in the shared crate.
const deciders = []
for (const [file, text] of sources) {
  const count = [...codeOnly(text).matchAll(PARSE_COMMAND)].length
  for (let index = 0; index < count; index += 1) deciders.push(file)
}
if (deciders.length !== 1) {
  problems.push(
    `${deciders.length} definitions of parse_command (${deciders.map(file => path.relative(REPO, file)).join(', ')}); `
    + 'a second collector-local parser is how the two platforms drifted apart',
  )
} else if (deciders[0] !== SHARED) {
  problems.push(
    `parse_command lives in ${path.relative(REPO, deciders[0])} instead of the shared crate `
    + `(${path.relative(REPO, SHARED)})`,
  )
}

// Rule 2: no other Rust file names a command keyword as a literal.
for (const [file, raw] of sources) {
  if (file === SHARED) continue
  if (COMMAND_LITERAL.test(codeOnly(raw))) {
    problems.push(
      `${path.relative(REPO, file)}: names a command keyword as a string literal - use the shared parser`,
    )
  }
}

// Self-checks: every rule and every spelling has to be exercised, or the rule is decoration.
const mustCatch = [
  ['escaped double quotes', '    if line.contains("\\"configure\\"") {'],
  ['escaped single quotes', "    if line.contains('\\\"configure\\\"') {"],
  ['plain single quotes', '    if line.contains(\'"configure"\') {'],
  ['plain double quotes', '    if line.contains("configure") {'],
  ['find instead of contains', '    let at = line.find(\'revision\');'],
  ['indirected const', '    const SCAN: &str = "configure";'],
  ['shutdown substring', '    if line.contains("shutdown") {'],
]
for (const [label, sample] of mustCatch) {
  if (!COMMAND_LITERAL.test(sample)) {
    problems.push(`the keyword rule misses the ${label} spelling: ${sample}`)
  }
}
const mustPass = [
  ['a call to the shared parser', 'let command = command::parse_command(&line);'],
  ['the paused state name', 'protocol::state("paused", trusted, None)'],
  ['an enum variant', 'Command::Configure { revision, policy } => vec![],'],
]
for (const [label, sample] of mustPass) {
  if (COMMAND_LITERAL.test(sample)) {
    problems.push(`the keyword rule flags ${label}: ${sample}`)
  }
}
// A keyword in prose is not a scan: this file's own explanation would otherwise fail the guard.
if (COMMAND_LITERAL.test(codeOnly('// it scanned for "configure" and "revision"\nlet x = 1;'))) {
  problems.push('the keyword rule reads a keyword out of a comment')
}
if (codeOnly('// "configure"\nlet y = 2;').includes('"configure"')) {
  problems.push('the comment stripper keeps an inline comment')
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(
  `collector command layer holds: one parser (${path.relative(REPO, SHARED)}), `
  + `${files.length} Rust files, no command keyword as a literal elsewhere`,
)
