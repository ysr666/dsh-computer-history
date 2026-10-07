#!/usr/bin/env node
// Strict Host -> ctx.subprocess -> collector transport against the exact
// platform binary carried by the already-assembled plugin tarball.
//
// This is deliberately separate from e2e-assembled-package.mjs:
// - that run proves a clean install selects the packaged binary with no override;
// - this run extracts that same packaged binary and drives the repository's
//   strict e2e:collector-transport seam explicitly.
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const filename = {
  darwin: 'dsh-computer-history-collector',
  win32: 'dsh-computer-history-collector-windows.exe',
  linux: 'dsh-computer-history-collector-linux',
}[process.platform]

if (!filename) {
  console.error(`no packaged collector transport target for ${process.platform}`)
  process.exit(2)
}

const directory = path.resolve(
  process.env.DSH_E2E_PACKAGE_DIR
  ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'assembled-plugin'),
)
const tarballs = readdirSync(directory)
  .filter(name => name.endsWith('.tgz'))
  .map(name => path.join(directory, name))
if (tarballs.length !== 1) {
  console.error(
    `expected exactly one plugin tarball in ${directory}, found ${tarballs.length}`,
  )
  process.exit(2)
}

const tarball = tarballs[0]
const scratch = mkdtempSync(path.join(os.tmpdir(), 'dch-packaged-transport-'))
try {
  const member = `package/bin/${filename}`
  const extracted = spawnSync(
    'tar',
    ['-xzf', tarball, '-C', scratch, member],
    { encoding: 'utf8' },
  )
  if (extracted.status !== 0) {
    console.error(
      `could not extract ${member}: ${extracted.stderr ?? extracted.stdout ?? ''}`,
    )
    process.exit(extracted.status ?? 1)
  }

  const collector = path.join(scratch, member)
  if (process.platform !== 'win32') chmodSync(collector, 0o755)

  console.log(
    `strict packaged transport: ${process.platform} -> ${member}`,
  )
  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/e2e-collector-transport.mjs')],
    {
      env: {
        ...process.env,
        COLLECTOR_EXECUTABLE: collector,
        DSH_E2E_TARBALL: tarball,
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
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
