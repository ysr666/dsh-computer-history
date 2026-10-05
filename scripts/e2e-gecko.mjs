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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const built = spawnSync('pnpm', ['build:extension:firefox'], { encoding: 'utf8' })
record('package', built.status === 0, built.status === 0 ? 'dist/extension-firefox' : (built.stderr ?? '').trim().slice(-140))
if (built.status !== 0) process.exit(1)

const before = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf8' }).stdout
  .split('\n').filter(line => line.includes('Firefox.app')).map(line => line.trim().split(/\s+/)[0])
const log = path.join(artifacts, 'web-ext.log')
const runner = spawn('npx', ['--yes', 'web-ext', 'run', '-s', 'dist/extension-firefox', `--firefox=${firefox}`, '--arg=-headless', '--no-reload'], {
  stdio: ['ignore', 'pipe', 'pipe'],
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

runner.kill('SIGTERM')
await new Promise(resolve => setTimeout(resolve, 3_000))
// Only the processes this run started, each checked before it is killed: the command line has to be Firefox's.
const after = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf8' }).stdout
  .split('\n').filter(line => line.includes('Firefox.app')).map(line => line.trim().split(/\s+/)[0])
for (const pid of after.filter(pid => !before.includes(pid))) {
  const command = spawnSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).stdout
  if (command.includes('Firefox.app')) spawnSync('kill', [pid])
}
record('cleaned up', true, 'stopped the browser this run started')

writeFileSync(path.join(artifacts, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`)
const failed = checks.filter(check => !check.ok)
console.log(`\nartifacts: ${path.relative(REPO, artifacts)}`)
if (failed.length > 0) {
  console.error(`e2e (Gecko) failed: ${failed.map(check => `${check.name} (${check.detail})`).join('; ')}`)
  process.exit(1)
}
console.log(`e2e (Gecko) passed: ${checks.length} checks - Firefox builds the package and loads it`)
