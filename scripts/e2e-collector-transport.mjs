#!/usr/bin/env node
// Durable live regression for the Host -> ctx.subprocess -> collector transport.
//
// Usage:
//   COLLECTOR_EXECUTABLE=<absolute collector path> pnpm e2e:collector-transport
//   DSH_RELEASE_TARBALL=<assembled.tgz> DSH_E2E_REQUIRE_PACKAGED_COLLECTOR=1 pnpm e2e:collector-transport
//
// This deliberately drives the production collector through the same throwaway Host and the same
// ctx.subprocess path as the product. The 2026-10-06 Windows investigation also used a dumb READY/PING/PONG
// helper to isolate the transport; that measurement proved the platform pipe itself was healthy. Keeping the
// production collector as the durable regression is stronger for this repository and avoids adding a test-only
// subprocess seam or another native fixture binary.
//
// scripts/e2e-macos.mjs becomes strict whenever COLLECTOR_EXECUTABLE is present: a collector that has not
// handshaken into running/paused/permission-required within the startup bound makes the command fail.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const collector = process.env.COLLECTOR_EXECUTABLE
const packaged =
  process.env.DSH_E2E_REQUIRE_PACKAGED_COLLECTOR === '1'
  && Boolean(process.env.DSH_RELEASE_TARBALL?.trim())
if (!collector && !packaged) {
  console.error(
    'Provide either COLLECTOR_EXECUTABLE for a development binary, or set both '
    + 'DSH_RELEASE_TARBALL and DSH_E2E_REQUIRE_PACKAGED_COLLECTOR=1 for an assembled package.',
  )
  process.exit(2)
}

const target = fileURLToPath(new URL('./e2e-macos.mjs', import.meta.url))
const result = spawnSync(process.execPath, [target], {
  env: process.env,
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
