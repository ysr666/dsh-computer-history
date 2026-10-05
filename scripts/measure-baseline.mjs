#!/usr/bin/env node
// Measure the experience baseline on a live Host, so "逐条度量" is a command and not a hand-run.
//
//   pnpm measure:baseline
//
// It boots a Host with its own ports and data directory, then reports the five assertions of
// .debug/baseline/05-proposal.md with the numbers it can measure from that Host: the setup actions a user has
// to perform (counted, not estimated), how many observations appear with no action at all, the semantic
// engine's state, the non-goal, and the named refusals.
//
// What it cannot measure here is stated with the reason: the companion refuses with `capture-not-owned` while
// another Host on the machine owns capture, so the cells that need a stored row say so instead of reporting a
// zero that means nothing.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)
const cli = process.env.DSH_CLI ?? 'dsh'
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(REPO, '.debug', 'baseline', `run-${stamp}`)
mkdirSync(artifacts, { recursive: true })
const rows = []
const say = (name, value, note) => { rows.push({ name, value, note }); console.log(`  ${name.padEnd(26)} ${value}   ${note}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const home = path.join(os.tmpdir(), `dsh-baseline-${path.basename(artifacts)}`)
const web = 19970 + Math.floor(Math.random() * 9)
const companion = web + 1
rmSync(home, { recursive: true, force: true })
const env = { ...process.env, DSH_HOME: home }
let host
let actions = 0

try {
  const add = spec => {
    actions += 1
    let r = spawnSync(cli, ['plugin', '--profile', 'baseline', 'add', spec], { env, encoding: 'utf8' })
    if (r.status !== 0) {
      const workspace = path.join(home, 'profiles', 'baseline', 'pnpm-workspace.yaml')
      if (existsSync(workspace)) writeFileSync(workspace, readFileSync(workspace, 'utf8').replaceAll(': set this to true or false', ': false'))
      r = spawnSync(cli, ['plugin', '--profile', 'baseline', 'add', spec], { env, encoding: 'utf8' })
    }
    return r.status === 0
  }
  actions += 1 // pack
  spawnSync('pnpm', ['pack', '--pack-destination', home])
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const installed = add('@deepseek-ai/dsh-web-app@0.2.0-rc.2') && add(path.join(home, `dsh-computer-history-${version}.tgz`))
  actions += 1 // the profile layer list, which the CLI leaves incomplete (measured: a dependency that is not a layer does not boot)
  {
    const manifestPath = path.join(home, 'profiles', 'baseline', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.dsh = { ...manifest.dsh, profile: { bundles: [...new Set([...(manifest.dsh?.profile?.bundles ?? []), ...Object.keys(manifest.dependencies ?? {})])] } }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(path.join(home, 'profiles', 'baseline', 'cordis.patch.yml'),
      `- id: computer-history\n  config:\n    enabled: true\n    dataDirectory: ${path.join(home, 'computer-history')}\n    companionPort: ${companion}\n    collectorRestart: false\n`)
  }
  if (!installed) say('setup actions to a Host', 'install failed', `${actions} attempted`)
  actions += 1 // boot
  host = spawn(cli, ['--profile', 'baseline', '--port', String(web), '--no-open'], { env, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let out = ''
  host.stdout.on('data', c => { out += c }); host.stderr.on('data', c => { out += c })
  for (let i = 0; i < 40 && !/token=/.test(out); i++) await sleep(1000)
  const token = /token=([A-Za-z0-9_-]+)/.exec(out)?.[1]
  writeFileSync(path.join(artifacts, 'host.log'), out)
  if (token === undefined) throw new Error('the Host never started; see host.log')
  const api = `http://127.0.0.1:${web}/api/computer-history`
  const jar = path.join(artifacts, 'cookies.txt')
  spawnSync('curl', ['-s', '-c', jar, '-o', '/dev/null', `http://127.0.0.1:${web}/?token=${token}`])
  const get = (p) => { try { return JSON.parse(spawnSync('curl', ['-s', '-b', jar, `${api}${p}`], { encoding: 'utf8' }).stdout) } catch { return {} } }

  // ① setup actions a user performs, and what a stored row would additionally need.
  const state = get('/state')
  const needsPermission = state.capture !== 'running'
  say('① setup actions', String(actions + (needsPermission ? 1 : 0) + (state.companion?.paired ? 0 : 1)),
    `(${actions} to a running Host + ${needsPermission ? '1 accessibility grant' : 'no grant needed'} + ${state.companion?.paired ? 'already paired' : '1 pairing'})`)

  // ② observations that appear with no action at all: read before doing anything else.
  const db = path.join(home, 'computer-history', 'history.sqlite')
  const rowsWithNoAction = spawnSync('sqlite3', [db, 'select count(*) from observations;'], { encoding: 'utf8' }).stdout.trim()
  say('② rows with no action', rowsWithNoAction, `companion paired=${state.companion?.paired ?? 'unknown'}`)

  // ③ the retrieval engine.
  const semantic = get('/semantic')
  say('③ semantic providers', `${Object.values(semantic.providers ?? {}).filter(p => p.available).length}/${Object.keys(semantic.providers ?? {}).length} available`,
    `active=${semantic.active ?? '?'}, scopes=${(semantic.scopes ?? []).length}`)

  // ④ the non-goal.
  say('④ cross-device', 'non-goal', 'the store is local by design; 0 sync paths')

  // ⑤ named refusals, measured over the wire. The intake authenticates first, so a valid companion token is
  // needed - and while another Host owns capture, the ownership refusal is what comes back instead.
  const pairing = JSON.parse(spawnSync('curl', ['-s', '-b', jar, '-X', 'POST', `${api}/pairing/rotate`], { encoding: 'utf8' }).stdout)
  const send = (body) => {
    const r = spawnSync('curl', ['-s', '-w', '\n%{http_code}', '-X', 'POST', `http://127.0.0.1:${companion}/companion/observation`,
      '-H', 'content-type: application/json', '-H', `x-companion-token: ${pairing.token ?? ''}`, '--data-binary', JSON.stringify(body)], { encoding: 'utf8' }).stdout
    const status = Number(r.trim().split('\n').pop())
    let parsed; try { parsed = JSON.parse(r.slice(0, r.lastIndexOf('\n'))) } catch { parsed = {} }
    return { status, parsed }
  }
  const base = { source: 'browser', origin: 'https://baseline.test', path: '/b', title: 'b', incognito: false, browserSession: 'baseline-1', seq: 1 }
  const future = send({ ...base, observedAtMs: Date.now() + 10 * 60_000 })
  const expired = send({ ...base, seq: 2, observedAtMs: Date.now() - 25 * 60 * 60_000 })
  const unknown = send({ ...base, seq: 3, text: 'document body' })
  const reasons = [future.parsed.reason, expired.parsed.reason, unknown.parsed.reason ?? unknown.parsed.error].filter(Boolean)
  const ownership = reasons.every(r => r === 'capture-not-owned')
  say('⑤ named refusals', ownership ? 'not measurable here' : reasons.join(' / ') || '(none)',
    ownership ? 'another Host owns capture; every cell would report that instead. In-process evidence: future-timestamp / expired / protected-app + a 400 naming the field' : `future=${future.status} expired=${expired.status} unknown=${unknown.status}`)

  writeFileSync(path.join(artifacts, 'measurements.json'), `${JSON.stringify(rows, null, 2)}\n`)
} catch (error) {
  say('run', 'failed', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (host?.pid !== undefined) { try { process.kill(-host.pid, 'SIGTERM') } catch {} }
  await sleep(2000)
  rmSync(home, { recursive: true, force: true })
}

console.log(`\nartifacts: ${path.relative(REPO, artifacts)}`)
console.log('Compare with .debug/baseline/05-proposal.md - the same five assertions, the same wording.')
