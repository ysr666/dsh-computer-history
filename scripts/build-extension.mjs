// Validate and package the companion extension for one engine.
//
//   pnpm build:extension            → dist/extension/           (load unpacked in Chromium)
//   pnpm build:extension:firefox    → dist/extension-firefox/   (load temporary add-on in Gecko)
//
// The extension is plain ESM, so "building" means: the manifest is MV3 and asks for nothing
// beyond tabs/storage/loopback, every script parses, and the privacy rules that make it a
// companion rather than a tracker still hold (`incognito: not_allowed`, no content script, no
// page-content API in the worker). Anything else is copied through unchanged, and the only
// difference between the two packages is which manifest becomes `manifest.json`.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const TARGETS = {
  chrome: { manifest: 'manifest.json', output: 'dist/extension' },
  firefox: { manifest: 'manifest.firefox.json', output: 'dist/extension-firefox' },
}

const requested = process.argv.find(argument => argument.startsWith('--target='))?.slice('--target='.length)
  ?? 'chrome'
const target = TARGETS[requested]
if (!target) {
  console.error(`unknown target: ${requested} (expected ${Object.keys(TARGETS).join(' or ')})`)
  process.exit(1)
}

const SOURCE = 'extension'
const OUTPUT = target.output

const manifest = JSON.parse(readFileSync(path.join(SOURCE, target.manifest), 'utf8'))
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
// The background declaration is the one place the engines genuinely differ, and asking the
// wrong key for the target means an extension that silently never starts.
if (requested === 'chrome' && manifest.background?.service_worker === undefined) {
  problems.push('chromium needs background.service_worker')
}
if (requested === 'firefox') {
  if (manifest.background?.service_worker !== undefined) {
    problems.push('gecko has no service worker: use background.scripts')
  }
  if (manifest.background?.scripts === undefined) {
    problems.push('gecko needs background.scripts')
  }
  if (manifest.options_page !== undefined) {
    problems.push('gecko uses options_ui, not options_page')
  }
}

// Every script must parse; a syntax error in a background worker surfaces only at runtime
// inside the browser, which is a bad place to find it. Listed rather than hardcoded so a new
// file cannot be added without being checked.
const scripts = readdirSync(SOURCE).filter(file => file.endsWith('.js')).toSorted()
for (const file of scripts) {
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

// Both manifests travel in the source tree so one directory can be loaded by either engine;
// the package keeps exactly one, named `manifest.json`.
rmSync(OUTPUT, { recursive: true, force: true })
mkdirSync(path.dirname(OUTPUT), { recursive: true })
cpSync(SOURCE, OUTPUT, {
  recursive: true,
  filter: (source) => !/^manifest(\.[a-z]+)?\.json$/.test(path.basename(source)),
})
writeFileSync(path.join(OUTPUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(
  `extension packaged for ${requested}: ${OUTPUT} (permissions: ${permissions.join(', ') || 'none'}; `
  + `loopback hosts: ${hosts.join(', ')}; scripts: ${scripts.join(', ')})`,
)
