#!/usr/bin/env node
// Record when the build happened, in a file that travels with the package.
//
// `runningRelease` used to date the build from `lib/index.js`'s mtime. That is wrong whenever the package is
// installed from a tarball through pnpm's content-addressed store, because the store hands out the file with the
// mtime of the entry that already held that content: measured 2026-10-06, a run reported a build 18 minutes
// older than the build it was actually running. The independent verifier proved the mechanism - the store file
// whose *name* is the sha512 of `lib/index.js` carried that older mtime. A build time has to come from the
// build, so the build writes it down.
import { mkdirSync, writeFileSync } from 'node:fs'

const target = new URL('../lib/build-info.json', import.meta.url)
mkdirSync(new URL('../lib/', import.meta.url), { recursive: true })
writeFileSync(target, `${JSON.stringify({ builtAtMs: Date.now() })}\n`)
console.log(`build info written to ${target.pathname}`)
