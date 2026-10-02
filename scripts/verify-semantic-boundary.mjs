// Guard: nothing that produces a summary may talk to the network.
//
//   node scripts/verify-semantic-boundary.mjs
//
// ADR 0004 allows a summary provider to be a model on this machine, and allows
// a remote model only behind a recorded per-scope opt-in. This guard keeps both
// halves honest by reading the code rather than a document:
//
//   1. inside src/host/semantic, exactly one file may contain a network call,
//      and it must be local-provider.ts;
//   2. that file must check its endpoint with assertLoopbackEndpoint;
//   3. any file that can construct a remote provider must also call
//      assertRemoteOptIn.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SEMANTIC_DIR = 'src/host/semantic'
// Every shape a request can take in this codebase, including the injected
// fetch implementation the providers use so tests can supply their own.
// Any identifier ending in `fetch`, not just the bare name: a provider that
// holds its transport in `doFetch` or `myFetch` is still a sender, and a
// regex that cannot see it is a guard that cannot fail.
const NETWORK_CALL = /\b\w*[Ff]etch\w*\s*\(|\bhttps?\.request\s*\(|\baxios\b/
const REMOTE_PROVIDER = /kind\s*=\s*'remote'|'remote'\s*as\s*const/

const violations = []

const files = readdirSync(SEMANTIC_DIR)
  .filter(name => name.endsWith('.ts'))
  .map(name => path.join(SEMANTIC_DIR, name))

const senders = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return
    if (NETWORK_CALL.test(line)) {
      senders.push({ file, line: index + 1 })
    }
  })
}

// Two files may send, and each must carry the check that belongs to it: the
// local provider proves its endpoint is loopback, the remote one proves the
// user recorded an opt-in for the scope. A file that sends without its check is
// a violation, and so is any third file that sends at all.
const ALLOWED_SENDERS = new Map([
  ['local-provider.ts', 'assertLoopbackEndpoint('],
  ['remote-provider.ts', 'assertRemoteOptIn('],
])

for (const sender of senders) {
  const name = path.basename(sender.file)
  const required = ALLOWED_SENDERS.get(name)
  if (required === undefined) {
    violations.push(
      `${sender.file}:${sender.line}: network call outside `
      + `${[...ALLOWED_SENDERS.keys()].join(' or ')}`,
    )
  }
}

for (const [name, required] of ALLOWED_SENDERS) {
  const text = readFileSync(path.join(SEMANTIC_DIR, name), 'utf8')
  if (!text.includes(required)) {
    violations.push(`${name} must check its endpoint with ${required}`)
  }
}


for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (REMOTE_PROVIDER.test(text) && !text.includes('assertRemoteOptIn(')) {
    violations.push(
      `${file}: can build a remote provider without assertRemoteOptIn`,
    )
  }
}

// Anti-vacuity: a guard that finds no sender at all is checking nothing, which
// is how a boundary quietly stops being enforced. The local provider is the one
// place allowed to send, so it must be found.
if (!senders.some(sender => sender.file === path.join(SEMANTIC_DIR, 'local-provider.ts'))) {
  violations.push(
    'no network call found in local-provider.ts: the detector no longer '
    + 'recognises how requests are made, so this guard proves nothing',
  )
}

// A detector that matches nothing looks exactly like a clean codebase, so prove
// it still recognises the shapes it is meant to catch before trusting a pass.
// The red calibration is therefore part of the guard rather than a manual run:
// the `doFetch` case is the one that was invisible until this phase.
for (const probe of ['fetch(', 'this.fetchImpl(', 'const doFetch = 1; doFetch(url)', 'myFetchImpl(']) {
  if (!NETWORK_CALL.test(probe)) {
    violations.push(
      `the network-call detector no longer matches: ${probe} - this guard proves nothing`,
    )
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log(
  `semantic boundary holds: ${senders.length} network call(s) in `
  + `${[...ALLOWED_SENDERS.keys()].join(' and ')}, each behind its own check`,
)
