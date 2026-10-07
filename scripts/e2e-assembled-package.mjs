#!/usr/bin/env node
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const directory = path.resolve(
  process.env.DSH_E2E_PACKAGE_DIR
  ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'assembled-plugin'),
)
const tarballs = readdirSync(directory)
  .filter(name => name.endsWith('.tgz'))
  .map(name => path.join(directory, name))
if (tarballs.length !== 1) {
  console.error(`expected exactly one plugin tarball in ${directory}, found ${tarballs.length}`)
  process.exit(2)
}

const result = spawnSync(
  process.execPath,
  [path.resolve('scripts/e2e-macos.mjs')],
  {
    env: {
      ...process.env,
      DSH_E2E_TARBALL: tarballs[0],
      DSH_E2E_REQUIRE_PACKAGED_COLLECTOR: '1',
    },
    stdio: 'inherit',
  },
)
if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
