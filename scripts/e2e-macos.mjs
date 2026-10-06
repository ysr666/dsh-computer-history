#!/usr/bin/env node
// One command for the macOS flow, so it stops depending on steps somebody remembered.
//
//   pnpm e2e:macos
//
// It builds the tarball, installs it into a throwaway DSH home, boots the Host on its own ports, checks the
// Host answers and that the companion either listens or says why not, writes the run's artifacts under
// .debug/e2e-macos/, and cleans up after itself. It never touches the user's own ~/.dsh: every path it uses is
// inside a temporary home, and every port is its own.
//
// What it deliberately does not claim by default: the macOS collector needs an Accessibility grant, and a
// collector spawned by a command-line Host may not have one. Without COLLECTOR_EXECUTABLE this run reports that
// state instead of asserting it. Supplying COLLECTOR_EXECUTABLE changes the contract: the caller has provided the
// collector under test, so the Host must finish its handshake and expose a live collector within the startup bound.
import { spawn, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Windows has no process groups, so `process.kill(-pid, ...)` fails there and the old `catch {}` swallowed it -
// measured 2026-10-06 on the Windows machine: the Host survived, kept its throwaway home busy and the cleanup
// ended the run with EPERM. `taskkill /T /F` is the Windows way to take down a process tree (the Host starts the
// collector as a child), and POSIX keeps the group-first, pid-second order it already had.
const killTree = pid => {
  if (process.platform === 'win32') {
    spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `taskkill /pid ${pid} /T /F`], { stdio: 'ignore' })
    return
  }
  try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
}

// The plugin carries a collector for macOS only. On a machine without one (Windows, or a checkout that has not
// built it) the Host starts, reports collector-exited and stops at a boundary - honest, but it exercises less than
// the machine can. Set COLLECTOR_EXECUTABLE to the binary and the runs use it.
const collectorLine = process.env.COLLECTOR_EXECUTABLE
  ? `    collectorExecutable: ${process.env.COLLECTOR_EXECUTABLE}\n`
  : ''
const collectorRequired = Boolean(process.env.COLLECTOR_EXECUTABLE)
const diagnosticTimeline = process.env.DSH_E2E_DIAGNOSTIC_TIMELINE === '1'
const explicitAllowBundles = (process.env.DSH_E2E_ALLOW_BUNDLES ?? '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const captureOptIn = process.env.DSH_E2E_ALLOW_PRESET === '1' || explicitAllowBundles.length > 0
const expectActivity = process.env.DSH_E2E_EXPECT_ACTIVITY === '1'
const expectedProvider = process.env.DSH_E2E_EXPECT_PROVIDER?.trim() || undefined
const activityTimeoutMs = Math.max(1_000, Number(process.env.DSH_E2E_ACTIVITY_TIMEOUT_MS ?? 20_000))

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)

const cli = process.env.DSH_CLI ?? 'dsh'
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(REPO, '.debug', 'e2e-macos', `run-${stamp}`)
mkdirSync(artifacts, { recursive: true })

// The CLI's profile template ships `allowBuilds:` with placeholder values (`<pkg>: set this to true or false`), and
// pnpm then refuses the install with ERR_PNPM_IGNORED_BUILDS for packages like koffi. Patching that used to be a
// single literal replacement attempted only after a failure; measured 2026-08-06 against the current CLI on a
// fresh profile, both attempts failed because the file only exists after the first attempt. This sets every
// placeholder to false - a rule, not one literal - and runs before the first attempt and again after a failure.
const allowBuildsOff = (workspace) => {
  try {
    if (!existsSync(workspace)) return false
    const text = readFileSync(workspace, 'utf8')
    const fixed = text.replace(/^(\s+[^\s:]+:\s*)set this to true or false\s*$/gm, '$1false')
    if (fixed === text) return false
    writeFileSync(workspace, fixed)
    return true
  } catch { return false }
}

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`)
}
// The Host is started with `spawn`; on Windows the CLI is a .cmd shim, same measurement as run() above.
// cmd.exe does not parse the escaping Node applies to a quoted argument: measured 2026-10-06 on the Windows
// machine, '"pnpm" "--version"' arrives as '\"pnpm\"' and is not recognised, while the unquoted command line
// exits 0. So the line is assembled unquoted and only arguments that contain whitespace are quoted.
const quoteForCmd = a => (/[\s"]/.test(String(a)) ? `"${a}"` : String(a))

const spawnCmd = (command, args, options) => process.platform === 'win32'
  ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')], { ...options, windowsVerbatimArguments: true })
  : spawn(command, args, options)

// `dsh` and `pnpm` are .cmd shims on Windows and Node refuses to spawn those without a shell; measured
// 2026-10-06 on the Windows machine: direct spawn -> ENOENT, "<name>.cmd" -> EINVAL, cmd.exe /d /s /c -> exit 0.
// On POSIX this is the same single spawnSync as before.
const run = (command, args, options = {}) => {
  const shim = process.platform === 'win32' && ['dsh', 'pnpm', 'npx'].includes(command)
  const result = shim
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')], { encoding: 'utf8', ...options, windowsVerbatimArguments: true })
    : spawnSync(command, args, { encoding: 'utf8', ...options })
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const version = run(cli, ['--version'])
if (version.status !== 0) {
  console.error(
    `${cli} is not runnable (${version.out.trim().split('\n')[0] ?? 'no output'}): set DSH_CLI to the CLI to use.\n`
    + 'The CLI has to be one whose own package set is consistent: measured 2026-10-05, a globally installed\n'
    + "dsh 0.1.2-rc.1 could not boot a profile it created itself (`@deepseek-ai/dsh-command-feedback` export\n"
    + "mismatch and `Cannot find package '@deepseek-ai/dsh-http-proxy'`), while 0.2.0-rc.2 could.",
  )
  process.exit(1)
}
console.log(`dsh e2e (macOS): ${version.out.trim().split('\n')[0]}`)

const home = mkdtempSync(path.join(os.tmpdir(), 'dsh-e2e-'))
const profile = 'e2e'
const webPort = 19600 + Math.floor(Math.random() * 200)
const companionPort = webPort + 1
let host

try {
  // 1. Pack the plugin the way it is released, into a temporary directory. The editor companion is an
  // intentionally independent pnpm project with its own lockfile and build-script policy; the release workflow
  // installs it before `pnpm pack`, so this one-command harness must do the same on a clean clone.
  const editorDeps = run('pnpm', ['install', '--frozen-lockfile'], { cwd: path.join(REPO, 'extension-editor') })
  record('install editor build deps', editorDeps.status === 0, editorDeps.status === 0 ? 'exit 0' : editorDeps.out.trim().slice(-240))
  if (editorDeps.status !== 0) throw new Error('editor build dependency install failed')

  rmSync(path.join(REPO, 'e2e-pack'), { recursive: true, force: true })
  mkdirSync(path.join(REPO, 'e2e-pack'), { recursive: true })
  const packed = run('pnpm', ['pack', '--pack-destination', path.join(REPO, 'e2e-pack')])
  const tarball = path.join(REPO, 'e2e-pack', `dsh-computer-history-${JSON.parse(readFileSync('package.json', 'utf8')).version}.tgz`)
  record('pack', packed.status === 0, packed.status === 0 ? path.relative(REPO, tarball) : packed.out.trim().slice(-160))
  if (packed.status !== 0) throw new Error('pack failed')

  // 2. Install into the throwaway home. The first add stops at the build-script gate, which is answered the same
  // way a person would answer it in the UI; the retry then succeeds.
  const env = { ...process.env, DSH_HOME: home }
  for (const spec of ['@deepseek-ai/dsh-web-app@0.2.0-rc.2', tarball]) {
    allowBuildsOff(path.join(home, 'profiles', profile, 'pnpm-workspace.yaml'))
    let added = run(cli, ['plugin', '--profile', profile, 'add', spec], { env })
    if (added.status !== 0) {
      const workspace = path.join(home, 'profiles', profile, 'pnpm-workspace.yaml')
      try {
        allowBuildsOff(workspace)
      } catch { /* the gate file may not be there; the retry reports it */ }
      allowBuildsOff(path.join(home, 'profiles', profile, 'pnpm-workspace.yaml'))
      added = run(cli, ['plugin', '--profile', profile, 'add', spec], { env })
    }
    const label = spec === tarball ? 'install plugin' : 'install web app'
    // Show the CLI's own diagnostics path and the tail of its pnpm log, not a 160-character truncation: when the
    // install fails, the reason lives in that file and a truncated path is a dead end.
    let why = added.out.trim()
    const logPath = /(\/[^\s]*\.plugin-manager\/logs\/operation-[^\s]*\/pnpm\.log)/.exec(added.out)?.[1]
    if (logPath && existsSync(logPath)) {
      why = `${why.split('\n').slice(-2).join(' ')} | ${readFileSync(logPath, 'utf8').trim().split('\n').slice(-4).join(' ')}`
    }
    record(label, added.status === 0, added.status === 0 ? 'exit 0' : why.slice(0, 400))
    if (added.status !== 0) throw new Error(`${label} failed`)
  }

  // 2b. The profile layer list. The CLI writes the dependency, but it skips reconciling a package that was
  // already in `dependencies` when it runs (an earlier attempt that failed after writing them is enough), and a
  // profile whose web application is a dependency but not a layer does not boot at all: measured 2026-10-05,
  // `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-http-proxy'`. This is the same step a person
  // following docs/release.md has to take, done here so the run is one command.
  {
    const manifestPath = path.join(home, 'profiles', profile, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const dependencies = Object.keys(manifest.dependencies ?? {})
    const bundles = [...new Set([...(manifest.dsh?.profile?.bundles ?? []), ...dependencies])]
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    record('profile layers', bundles.includes('@deepseek-ai/dsh-web-app'), bundles.join(', '))
  }

  // 3. Own ports and own data directory: the companion's default is fixed (19388), which collides with a user's
  // running instance, and this run must never share capture with it.
  writeFileSync(path.join(home, 'profiles', profile, 'cordis.patch.yml'), `# Written by scripts/e2e-macos.mjs.
- id: computer-history
  config:
    enabled: true
    dataDirectory: ${path.join(home, 'computer-history')}
    companionPort: ${companionPort}
${collectorLine}    collectorRestart: false
`)

  // 4. Boot and wait for the web port.
  const log = path.join(artifacts, 'host.log')
  host = spawnCmd(cli, ['--profile', profile, '--port', String(webPort), '--no-open'], {
    env, cwd: os.tmpdir(), detached: false, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  host.stdout.on('data', chunk => { output += String(chunk) })
  host.stderr.on('data', chunk => { output += String(chunk) })
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_000))
    if (/token=([A-Za-z0-9_-]+)/.test(output)) break
  }
  writeFileSync(log, output)
  const token = /token=([A-Za-z0-9_-]+)/.exec(output)?.[1] ?? ''
  record('host listens', token !== '', token === '' ? 'no "token=" line in the log within 90s' : `port ${webPort}`)
  if (token === '') throw new Error('the host never started')

  // 5. Ask it what it thinks. Every failure has to be named: a bare "not running" is what made the original
  // silent-capture problem invisible.
  const jar = path.join(artifacts, 'cookies.txt')
  const api = `http://127.0.0.1:${webPort}/api/computer-history`
  // -o into the artifacts, not /dev/null: that path does not exist on Windows, and this keeps the response.
  run('curl', ['-s', '-c', jar, '-o', path.join(artifacts, 'bootstrap.html'), `http://127.0.0.1:${webPort}/?token=${token}`])
  // Optional: write the product preset as an allow rule - exactly what the panel's own button does. An isolated
  // Host allows nothing (its policy is include-only with no allow rule, because the first-run consent only runs in
  // a real installation), so a run that generates real desktop activity still records zero rows: measured on
  // Windows 2026-10-06 with thirteen real windows open and an empty store. Correct behaviour, useless capture test.
  if (captureOptIn) {
    let firstRead = {}
    try { firstRead = JSON.parse(run('curl', ['-s', '-b', jar, `${api}/state`]).out) } catch { /* recorded below */ }
    const allowedBundles = explicitAllowBundles.length > 0
      ? explicitAllowBundles
      : (firstRead.firstRunPreset?.bundles ?? [])
    const nowMs = Date.now()
    const rules = allowedBundles.map(bundle => ({
      id: `e2e:${bundle}`,
      dimension: 'app',
      action: 'allow',
      matcher: 'exact',
      pattern: bundle,
      builtIn: false,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    }))
    const written = run('curl', [
      '-s', '-b', jar, '-X', 'POST', '-H', 'content-type: application/json',
      '-d', JSON.stringify({ mode: 'include-only', rules }), `${api}/policy`,
    ]).out
    let echoed = {}
    try { echoed = JSON.parse(written) } catch { /* recorded below */ }
    record(
      explicitAllowBundles.length > 0 ? 'allow explicit bundles (opt-in)' : 'allow preset (opt-in)',
      rules.length > 0 && Array.isArray(echoed.rules) && echoed.rules.length >= rules.length,
      `${rules.length} allowed bundles -> revision ${echoed.revision ?? '?'} with ${echoed.rules?.length ?? 0} rules`,
    )
  }

  const stateRaw = run('curl', ['-s', '-b', jar, `${api}/state`]).out
  writeFileSync(path.join(artifacts, 'state.json'), stateRaw)
  let state = {}
  try { state = JSON.parse(stateRaw) } catch { /* reported below */ }
  record('GET /state', typeof state.capture === 'string', `capture=${state.capture ?? '(no capture field)'}`)
  const companion = state.companion ?? {}
  record(
    'companion',
    companion.listening === true || typeof companion.reason === 'string',
    companion.listening === true ? `listening on ${companion.port}` : `not listening, reason=${companion.reason ?? '(none!)'}`,
  )
  // Read a state the Host has settled on, not the one it has one second after boot. Measured on Windows
  // 2026-10-06: the first read answered `capture: degraded, reason: collector-starting` and two seconds later the
  // same Host answered `running` with its collector field present - the handshake simply had not finished. The
  // earlier false diagnosis came from separate runs that each sampled only once during that startup window.
  let settled = state
  for (let i = 0; i < 12; i += 1) {
    const waiting = settled.reason === 'collector-starting' || settled.collector === undefined
    if (!waiting) break
    await new Promise(resolve => setTimeout(resolve, 1000))
    try { settled = JSON.parse(run('curl', ['-s', '-b', jar, `${api}/state`]).out) } catch { /* keep the last read */ }
  }

  const collectorHealthy = Boolean(settled.collector)
    && ['running', 'paused', 'permission-required'].includes(settled.capture)
  const collectorDetail =
    `state=${settled.capture} reason=${settled.reason ?? '(none)'} collector=${settled.collector ? 'yes' : 'no'}`
  record(
    collectorRequired ? 'collector settles' : 'collector (reported, not asserted)',
    collectorRequired ? collectorHealthy : true,
    collectorDetail,
  )

  // The normal happy path no longer sleeps another sixteen seconds merely to prove it is still healthy. A timeline
  // is diagnostic evidence: collect it only when a supplied collector failed to settle, or when explicitly asked.
  if ((collectorRequired && !collectorHealthy) || diagnosticTimeline) {
    const watched = []
    for (let i = 0; i < 8; i += 1) {
      const raw = run('curl', ['-s', '-b', jar, `${api}/state`]).out
      let seen = {}
      try { seen = JSON.parse(raw) } catch { /* recorded as unknown below */ }
      const line = `${seen.capture ?? '?'}/reason=${seen.reason ?? '(none)'}/collector=${seen.collector ? 'yes' : 'no'}`
      if (watched.at(-1)?.line !== line) watched.push({ atMs: i * 2000, line })
      if (i < 7) await new Promise(resolve => setTimeout(resolve, 2000))
    }
    writeFileSync(path.join(artifacts, 'state-timeline.json'), `${JSON.stringify(watched, null, 2)}\n`)
    record(
      'collector over time (diagnostic)',
      true,
      watched.map(w => `${w.atMs}ms ${w.line}`).join('  ->  '),
    )
  }

  if (collectorRequired && !collectorHealthy) {
    throw new Error(`collector did not settle within 12s: ${collectorDetail}`)
  }

  const db = path.join(home, 'computer-history', 'history.sqlite')
  // node:sqlite rather than the `sqlite3` CLI (absent on Windows, and this command is meant to be runnable on
  // the platforms the collector supports). The repository already reads stores this way elsewhere.
  let counts
  try {
    const store = new DatabaseSync(db, { readOnly: true })
    const row = store.prepare('select (select count(*) from episodes) as e, (select count(*) from observations) as o').get()
    store.close()
    counts = { status: 0, out: `${row.e}|${row.o}` }
  } catch (error) {
    counts = { status: 1, out: error instanceof Error ? error.message : String(error) }
  }
  record('store opens', counts.status === 0, counts.status === 0 ? `episodes/observations = ${counts.out.trim().split('|').join('|')}` : counts.out.slice(-120))

  // A normal opt-in run merely reports whatever activity happened. A cross-platform live run can opt into the
  // stricter contract with DSH_E2E_EXPECT_ACTIVITY=1: then a real observation and a materialized Episode must
  // reach the throwaway store within the bound. This is what turns collector `running` into end-to-end evidence.
  if (captureOptIn) {
    let after = { e: 0, o: 0 }
    let latest = undefined
    let recent = []
    const activityDeadline = Date.now() + activityTimeoutMs
    do {
      try {
        const store = new DatabaseSync(db, { readOnly: true })
        after = store.prepare('select (select count(*) from episodes) as e, (select count(*) from observations) as o').get()
        latest = store.prepare('select bundle_id, window_title, source_provider, source_adapter from observations order by id desc limit 1').get()
        store.close()
      } catch { /* recorded below */ }
      try {
        const parsed = JSON.parse(run('curl', ['-s', '-b', jar, `${api}/recent?limit=10`]).out)
        recent = Array.isArray(parsed) ? parsed : []
      } catch { /* recorded below */ }
      if (!expectActivity || (Number(after.o) > 0 && Number(after.e) > 0 && recent.length > 0)) break
      // oxlint-disable-next-line no-await-in-loop -- polling must observe the next committed Host state
      await new Promise(resolve => setTimeout(resolve, 1_000))
    } while (Date.now() < activityDeadline)

    record(
      expectActivity ? 'activity reaches store' : 'store after the settle window (reported, not asserted)',
      expectActivity ? Number(after.o) > 0 : true,
      `episodes/observations = ${after.e}|${after.o}${latest ? ` latest=${latest.bundle_id}/${latest.source_provider}/${latest.source_adapter}` : ''}`,
    )
    if (expectActivity) {
      record(
        'recent episode materializes',
        Number(after.e) > 0 && recent.length > 0,
        recent.length > 0
          ? `${recent.length} row(s), first=${recent[0]?.id ?? '(no id)'}`
          : `no /recent row within ${activityTimeoutMs}ms`,
      )
      if (expectedProvider) {
        record(
          'activity provenance',
          latest?.source_provider === expectedProvider,
          `expected=${expectedProvider} stored=${latest?.source_provider ?? '(none)'}`,
        )
      }
    }
  }
} catch (error) {
  record('run', false, error instanceof Error ? error.message : String(error))
} finally {
  if (host?.pid !== undefined) {
    killTree(host.pid)
    await new Promise(resolve => setTimeout(resolve, 2_000))
    if (host.exitCode === null) host.kill('SIGKILL')
  }
  writeFileSync(path.join(artifacts, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`)
  if (process.env.DSH_E2E_KEEP === '1') {
    console.log(`  (kept ${home} because DSH_E2E_KEEP=1)`)
  } else {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    rmSync(path.join(REPO, 'e2e-pack'), { recursive: true, force: true })
  }
}

const failed = checks.filter(check => !check.ok)
console.log(`\nartifacts: ${path.relative(REPO, artifacts)}`)
if (failed.length > 0) {
  console.error(`e2e (macOS) failed: ${failed.map(check => `${check.name} (${check.detail})`).join('; ')}`)
  process.exit(1)
}
console.log(`e2e (macOS) passed: ${checks.length} checks - the Host boots, answers, and names what it cannot do`)
