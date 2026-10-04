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
//     then sees a revision mismatch and degrades), and a revision longer than a few digits was truncated
//     to nothing. Both were found by driving the real binary.
//
// The rule that removes the class: exactly one function decides what a line means, it lives in the shared
// crate beside the message layer, and no other collector source scans the line for command text.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const NATIVE = path.join(REPO, 'native')
const SHARED = path.join(NATIVE, 'collector-protocol', 'src', 'command.rs')

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

/** Command text a hand-written scan would look for, in the two shapes that existed. */
const RAW_SCAN = /contains\(\s*"\\"configure\\""|split\(\s*"\\"revision\\":|contains\(\s*'\\"configure\\"'/

const problems = []
const files = sourceFiles(NATIVE)
if (files.length === 0) {
  problems.push(`${NATIVE}: no Rust sources found - this guard proves nothing`)
}

const deciders = files.filter(file => /pub fn parse_command/.test(readFileSync(file, 'utf8')))
if (deciders.length !== 1) {
  problems.push(
    `${deciders.length} files define parse_command (${deciders.map(file => path.relative(REPO, file)).join(', ')}); `
    + 'a second collector-local parser is how the two platforms drifted apart',
  )
} else if (deciders[0] !== SHARED) {
  problems.push(
    `parse_command lives in ${path.relative(REPO, deciders[0])} instead of the shared crate `
    + `(${path.relative(REPO, SHARED)})`,
  )
}

for (const file of files) {
  if (file === SHARED) continue
  const text = readFileSync(file, 'utf8')
  if (RAW_SCAN.test(text)) {
    problems.push(
      `${path.relative(REPO, file)}: scans the raw command line instead of using the shared parser`,
    )
  }
}

// Self-checks: the guard has to be able to fail, and the shared file must actually be the decider.
if (RAW_SCAN.test('    if line.contains("\\"configure\\"") {')) {
  // expected to match
} else {
  problems.push('the raw-scan rule no longer recognises the shape it was written for')
}
if (RAW_SCAN.test('let command = command::parse_command(&line);')) {
  problems.push('the raw-scan rule flags a legitimate use of the shared parser')
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(
  `collector command layer holds: one parser (${path.relative(REPO, SHARED)}), `
  + `${files.length} Rust files, no hand-written scans`,
)
