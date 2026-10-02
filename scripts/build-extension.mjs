// Validate and package the companion extension for loading in Chrome.
//
//   pnpm build:extension      → dist/extension/ (load unpacked from there)
//
// The extension is plain ESM, so "building" means: the manifest is MV3 and
// asks for nothing beyond tabs/storage/loopback, every script parses, and the
// privacy rules that make it a companion rather than a tracker still hold
// (`incognito: not_allowed`, no content script, no page-content API in the
// worker). Anything else is copied through unchanged.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const SOURCE = 'extension'
const OUTPUT = 'dist/extension'

const manifest = JSON.parse(
  readFileSync(path.join(SOURCE, 'manifest.json'), 'utf8'),
)
const problems = []

if (manifest.manifest_version !== 3) {
  problems.push('manifest_version must be 3')
}
if (manifest.incognito !== 'not_allowed') {
  // ADR 0007: the extension must not even be able to see a private window.
  problems.push('incognito must be "not_allowed"')
}
if (manifest.content_scripts !== undefined) {
  problems.push('no content scripts: they would run inside pages')
}
const permissions = [...(manifest.permissions ?? [])].toSorted()
const allowedPermissions = new Set(['storage', 'tabs'])
for (const permission of permissions) {
  if (!allowedPermissions.has(permission)) {
    problems.push(`unexpected permission: ${permission}`)
  }
}
const hosts = manifest.host_permissions ?? []
for (const host of hosts) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)\//.test(host)) {
    problems.push(`host permission must stay on loopback: ${host}`)
  }
}

// Every script must parse; a syntax error in a service worker surfaces only at
// runtime inside Chrome, which is a bad place to find it.
for (const file of ['lib.js', 'service-worker.js', 'options.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(SOURCE, file)], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    problems.push(`${file}: ${result.stderr.trim()}`)
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

rmSync(OUTPUT, { recursive: true, force: true })
mkdirSync(path.dirname(OUTPUT), { recursive: true })
cpSync(SOURCE, OUTPUT, { recursive: true })
console.log(
  `extension packaged: ${OUTPUT} (permissions: ${permissions.join(', ') || 'none'}; `
  + `loopback hosts: ${hosts.join(', ')})`,
)
