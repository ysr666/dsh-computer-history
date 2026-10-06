#!/usr/bin/env node
// The Gecko end, loaded by a real Gecko engine.
//
//   pnpm e2e:gecko
//
// The audit's finding was precise: the Firefox package was built and its manifest was checked, but nothing had
// ever loaded it - "There is no live Gecko row" in docs/validation-three-platforms.md. This runs Mozilla's own
// loader (`web-ext`) against the installed Firefox, asserts that it reports the extension installed, and stops
// the browser again. What it does not do is pair it: the token lives in the extension's options page, which is
// one dialog, and docs/companion.md documents it as such. This check covers everything up to that dialog.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)

const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(REPO, '.debug', 'e2e-gecko', `run-${stamp}`)
mkdirSync(artifacts, { recursive: true })

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`)
}

const firefox = process.env.FIREFOX_BIN ?? '/opt/homebrew/bin/firefox'
if (spawnSync(firefox, ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.error(`no Gecko engine at ${firefox}: install Firefox, or set FIREFOX_BIN to its binary`)
  process.exit(1)
}

const built = runCmd('pnpm', ['build:extension:firefox'], { encoding: 'utf8' })
record('package', built.status === 0, built.status === 0 ? 'dist/extension-firefox' : (built.stderr ?? '').trim().slice(-140))
if (built.status !== 0) process.exit(1)

// Everything this run starts carries the profile directory it was given, so the browser can be identified
// precisely. Diffing "Firefox processes before vs after" was the first version of this and it can kill a
// browser another agent started in the same workspace - the independent verifier flagged exactly that.
const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-gecko-profile-'))
const log = path.join(artifacts, 'web-ext.log')
// cmd.exe does not parse the escaping Node applies to a quoted argument: measured 2026-10-06 on the Windows
// machine, '"pnpm" "--version"' arrives as '\"pnpm\"' and is not recognised, while the unquoted command line
// exits 0. So the line is assembled unquoted and only arguments that contain whitespace are quoted.
const quoteForCmd = a => (/[\s"]/.test(String(a)) ? `"${a}"` : String(a))

const webExtArgs = ['--yes', 'web-ext', 'run', '-s', 'dist/extension-firefox', `--firefox=${firefox}`,
  `--firefox-profile=${profileDir}`, '--arg=-headless', '--no-reload']
// `npx` is a .cmd shim on Windows, same measurement as runCmd above.
const runner = spawn(...(process.platform === 'win32'
  ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ['npx', ...webExtArgs].map(quoteForCmd).join(' ')]]
  : ['npx', webExtArgs]), {
  stdio: ['ignore', 'pipe', 'pipe'],
  // Its own process group, so the whole tree goes down together: killing by name or by a before/after diff
  // leaves the browser's helper processes behind - measured, 8 of them survived the first version of this.
  detached: true,
})
let output = ''
runner.stdout.on('data', chunk => { output += String(chunk) })
runner.stderr.on('data', chunk => { output += String(chunk) })
const deadline = Date.now() + 120_000
while (Date.now() < deadline && !/as a temporary add-on/.test(output)) {
  await new Promise(resolve => setTimeout(resolve, 2_000))
}
writeFileSync(log, output)
const installed = /Installed .* as a temporary add-on/.test(output)
record(
  'Firefox loads it',
  installed,
  installed ? 'web-ext reports it installed as a temporary add-on' : output.trim().split('\n').slice(-2).join(' / ').slice(0, 160) || 'no output from web-ext',
)

// Firefox re-parents itself out of the group web-ext was started in, so a group kill misses it: measured, the
// "cleaned up" line printed while eleven of its processes were still alive. Kill by this run's own profile
// directory instead, then check rather than assume - the check fails if anything is left.
// `ps` and `kill` are not on Windows. Where `ps` is missing the survivor check cannot run at all, and saying
// "0 survivors" then would be a claim nobody verified - so the check reports that it was skipped instead.
const psProbe = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf8' })
const psAvailable = !psProbe.error
const browsersOnThisProfile = () => (psAvailable ? (psProbe.stdout ?? '').split('\n') : [])
  .filter(line => /^\s*\d+\s+\/Applications\/Firefox\.app\//.test(line) && line.includes(profileDir))
  .map(line => line.trim().split(/\s+/)[0])
const sweep = () => { for (const pid of browsersOnThisProfile()) { try { process.kill(Number(pid), 'SIGKILL') } catch { /* already gone */ } } }
try { process.kill(-runner.pid, 'SIGTERM') } catch { /* already gone */ }
await new Promise(resolve => setTimeout(resolve, 2_000))
sweep()
await new Promise(resolve => setTimeout(resolve, 2_000))
sweep()
await new Promise(resolve => setTimeout(resolve, 1_000))
const survived = browsersOnThisProfile().length
rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
record('cleaned up', !psAvailable || survived === 0, psAvailable
  ? (survived === 0
    ? `stopped the browser running ${path.basename(profileDir)} (its own profile), nothing left`
    : `${survived} of this run's browser processes survived`)
  : 'not verifiable here: no ps on this platform, so no survivor could be counted')

writeFileSync(path.join(artifacts, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`)
const failed = checks.filter(check => !check.ok)
console.log(`\nartifacts: ${path.relative(REPO, artifacts)}`)
if (failed.length > 0) {
  console.error(`e2e (Gecko) failed: ${failed.map(check => `${check.name} (${check.detail})`).join('; ')}`)
  process.exit(1)
}
console.log(`e2e (Gecko) passed: ${checks.length} checks - Firefox builds the package and loads it`)
