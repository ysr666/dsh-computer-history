#!/usr/bin/env node
// One command for the Chromium companion end.
//
//   pnpm e2e:chromium
//
// It boots a Host with its own ports and its own data directory, then runs the repository's own privacy matrix
// (scripts/verify/chrome-companion.mjs) against it: the extension is loaded over CDP - Chrome 154 ignores
// --load-extension, which docs/companion.md already records - paired from its options page, and every cell is
// counted in the store. Artifacts land under .debug/e2e-chromium/.
//
// One precondition it cannot satisfy by itself, and says so instead of pretending: the companion intake refuses
// with `capture-not-owned` while another Host on this machine owns capture. On a machine running the desktop
// app that is the normal state, so the run reports that boundary by name and exits non-zero - a green matrix
// here would otherwise mean nothing.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)
const cli = process.env.DSH_CLI ?? 'dsh'
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(REPO, '.debug', 'e2e-chromium', `run-${stamp}`)
mkdirSync(artifacts, { recursive: true })
// The matrix prints one PASS/FAIL line per cell; collecting them is what makes a boundary run leave a
// structured record instead of only a log. The other three commands write checks.json too.
const evidence = []
const log = (...a) => console.log(' ', ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const home = path.join(os.tmpdir(), `dsh-chromium-${path.basename(artifacts)}`)
const web = 19960 + Math.floor(Math.random() * 20)
const companion = web + 1
rmSync(home, { recursive: true, force: true })
const env = { ...process.env, DSH_HOME: home }
let host

try {
  const add = spec => {
    let r = spawnSync(cli, ['plugin', '--profile', 'chromium', 'add', spec], { env, encoding: 'utf8' })
    if (r.status !== 0) {
      const workspace = path.join(home, 'profiles', 'chromium', 'pnpm-workspace.yaml')
      if (existsSync(workspace)) writeFileSync(workspace, readFileSync(workspace, 'utf8').replaceAll(': set this to true or false', ': false'))
      r = spawnSync(cli, ['plugin', '--profile', 'chromium', 'add', spec], { env, encoding: 'utf8' })
    }
    return r
  }
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', home], { encoding: 'utf8' })
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const tarball = path.join(home, `dsh-computer-history-${version}.tgz`)
  const webApp = add('@deepseek-ai/dsh-web-app@0.2.0-rc.2')
  const plugin = packed.status === 0 ? add(tarball) : { status: 1, stderr: 'pack failed' }
  log('install:', webApp.status === 0 && plugin.status === 0 ? 'ok' : `failed (${(plugin.stderr ?? '').trim().slice(-90)})`)
  if (webApp.status !== 0 || plugin.status !== 0) throw new Error('install failed')
  {
    // The layer list, the same step docs/release.md describes: a dependency that is not a layer means the
    // profile does not boot at all.
    const manifestPath = path.join(home, 'profiles', 'chromium', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.dsh = { ...manifest.dsh, profile: { bundles: [...new Set([...(manifest.dsh?.profile?.bundles ?? []), ...Object.keys(manifest.dependencies ?? {})])] } }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(path.join(home, 'profiles', 'chromium', 'cordis.patch.yml'),
      `- id: computer-history\n  config:\n    enabled: true\n    dataDirectory: ${path.join(home, 'computer-history')}\n    companionPort: ${companion}\n    collectorRestart: false\n`)
  }

  host = spawn(cli, ['--profile', 'chromium', '--port', String(web), '--no-open'], { env, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let out = ''
  host.stdout.on('data', c => { out += c }); host.stderr.on('data', c => { out += c })
  for (let i = 0; i < 40 && !/token=/.test(out); i++) await sleep(1000)
  const token = /token=([A-Za-z0-9_-]+)/.exec(out)?.[1]
  writeFileSync(path.join(artifacts, 'host.log'), out)
  if (token === undefined) {
    // The known signature of a CLI whose own package set is inconsistent (measured 2026-10-06: a globally
    // installed dsh 0.1.2-rc.1 cannot boot a profile it created itself). Naming it saves the next reader the
    // twenty minutes it cost here.
    const broken = /command-feedback|dsh-http-proxy/.test(out)
    throw new Error(broken
      ? 'the Host never started, and host.log shows the CLI cannot boot its own profile: set DSH_CLI to a CLI whose package set is consistent'
      : 'the Host never started; see host.log')
  }

  const jar = path.join(artifacts, 'cookies.txt')
  spawnSync('curl', ['-s', '-c', jar, '-o', path.join(artifacts, 'bootstrap.html'), `http://127.0.0.1:${web}/?token=${token}`])
  const pairing = JSON.parse(spawnSync('curl', ['-s', '-b', jar, '-X', 'POST', `http://127.0.0.1:${web}/api/computer-history/pairing/rotate`], { encoding: 'utf8' }).stdout)
  // The matrix script wants a file whose one line is `cookie=<name>=<value>`.
  const cookieLine = readFileSync(jar, 'utf8').split('\n').filter(l => l.includes('dsh-auth'))
    .map(l => { const f = l.split('\t'); return `cookie=${f[5]}=${f[6]}` })[0]
  const cookieFile = path.join(artifacts, 'cookie.txt')
  writeFileSync(cookieFile, `${cookieLine ?? ''}\n`)

  const matrix = spawnSync('node', [path.join(REPO, 'scripts/verify/chrome-companion.mjs'),
    '--token', pairing.token ?? '', '--db', path.join(home, 'computer-history', 'history.sqlite'),
    '--api', `http://127.0.0.1:${web}/api/computer-history`, '--cookie', cookieFile,
    '--extension', path.join(REPO, 'dist/extension'), '--port', String(companion)], { encoding: 'utf8' })
  writeFileSync(path.join(artifacts, 'matrix.log'), `${matrix.stdout ?? ''}${matrix.stderr ?? ''}`)
  const lines = `${matrix.stdout ?? ''}`.split('\n').filter(l => /^(PASS|FAIL|extension id|.the control cell)/.test(l))
  for (const line of lines) {
    log(line.slice(0, 150))
    evidence.push({ line: line.slice(0, 200), ok: line.startsWith('PASS') })
  }

  // Ask the Host why anything was refused: that is where `capture-not-owned` shows up by name.
  const state = JSON.parse(spawnSync('curl', ['-s', '-b', jar, `http://127.0.0.1:${web}/api/computer-history/state`], { encoding: 'utf8' }).stdout || '{}')
  writeFileSync(path.join(artifacts, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
  const refused = state.refusedByReason ?? {}
  log('refusedByReason:', JSON.stringify(refused))
  if (matrix.status !== 0) {
    if (refused['capture-not-owned'] !== undefined) {
      console.error('\ne2e (Chromium) stopped at a boundary, not a defect: this machine already has a Host that owns')
      console.error(`capture, so the isolated Host refused ${refused['capture-not-owned']} report(s) by name. The extension half worked: it loaded`)
      console.error('over CDP, was paired from its options page, and its reports reached this Host. Quit the other ')
      console.error('Host, or run scripts/verify/chrome-companion.mjs against the one that owns capture.')
    } else {
      // Show why, not just where: the matrix script's own sentence ("no Chrome at …", a failing cell) is the
      // useful part, and a reader should not have to open a log to reach it.
      const tail = `${matrix.stdout ?? ''}${matrix.stderr ?? ''}`.trim().split('\n').slice(-4).join('\n')
      console.error(`\ne2e (Chromium) failed:\n${tail}`)
      console.error(`\nfull log: ${path.relative(REPO, path.join(artifacts, 'matrix.log'))}`)
    }
    process.exitCode = 1
  } else {
    log('matrix passed: every cell counted in this Host\'s own store')
  }
} catch (error) {
  console.error(`e2e (Chromium) failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  // Written on every exit path, including the boundary and the failure ones: a run that stops at a boundary is
  // still a run whose evidence someone will want, and the other three commands write this file.
  writeFileSync(path.join(artifacts, 'checks.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  if (host?.pid !== undefined) {
    // Kill the group when there is one and the process when there is not, then check: the earlier version only
    // tried the group and swallowed every error, so a Host that was not a group leader survived the run
    // silently - measured 2026-10-06, two `--profile chromium` Hosts left behind by two failure-path runs.
    try { process.kill(-host.pid, 'SIGTERM') } catch { /* not a group leader */ }
    try { process.kill(host.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  await sleep(2500)
  // Browsers started by the matrix script: only those whose profile lives in the temp directory, checked by
  // prefix on the executable too - a substring test can match the shell that runs it. This sweep knows the
  // macOS paths only; elsewhere the matrix script removes the profile it created itself.
  // `ps` and `kill` do not exist on Windows. Where they do, this sweep still does its job; where they do not,
  // say so instead of implying the sweep ran (the matrix script removes the profile it created itself).
  const listing = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf8' })
  if (listing.error) {
    console.log(`  (browser sweep skipped: no ps on this platform - ${listing.error.code ?? 'unavailable'})`)
  } else {
    for (const line of (listing.stdout ?? '').split('\n')) {
      if (/^\s*\d+\s+\/Applications\/Google Chrome\.app\//.test(line) && /\/var\/folders\/|\/tmp\//.test(line)) {
        try { process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGKILL') } catch { /* already gone */ }
      }
    }
  }
  await sleep(1500)
  // A cleanup that reports success while leaving a process behind is a claim, not a cleanup: say it out loud.
  const survived = host?.pid !== undefined && spawnSync('ps', ['-p', String(host.pid)], { encoding: 'utf8' }).status === 0
  writeFileSync(path.join(artifacts, 'done.json'), `${JSON.stringify({ exit: process.exitCode ?? 0, hostSurvived: survived }, null, 2)}\n`)
  if (survived) console.error(`warning: the Host (pid ${host.pid}) outlived the run; done.json records hostSurvived: true`)
  rmSync(home, { recursive: true, force: true })
}
