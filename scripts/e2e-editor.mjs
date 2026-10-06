#!/usr/bin/env node
// One command for the wire format the editor companions speak - the VS Code extension and the JetBrains client
// both implement it, and docs/editor-companion.md documents it as "the wire format, for another editor".
//
//   pnpm e2e:editor
//
// The Host installs only its bundled VSIX (code --install-extension, VS Code only), so what a command can verify
// for another editor is the contract: an editor-shaped payload is stored, the browser token cannot speak for an
// editor, and document text is not merely unwelcome but inexpressible - the payload shape has no field for it.
import { spawn, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// Windows resolves `dsh`, `pnpm` and `npx` to .cmd shims, and Node refuses to spawn a .cmd without a shell.
// Measured on the Windows machine 2026-10-06: `spawnSync('dsh', ...)` -> status null, error ENOENT;
// `spawnSync('dsh.cmd', ...)` -> EINVAL; `cmd.exe /d /s /c` -> exit 0. Real executables (node, curl.exe, git, tar)
// are spawned directly, exactly as before.
// Same measurement as runCmd: the Host is started with `spawn`, and `dsh` is a .cmd shim on Windows.

const spawnCmd = (command, args, options) => process.platform === 'win32'
  ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')], { ...options, windowsVerbatimArguments: true })
  : spawn(command, args, options)

// cmd.exe does not parse the escaping Node applies to a quoted argument: measured 2026-10-06 on the Windows
// machine, '"pnpm" "--version"' arrives as '\"pnpm\"' and is not recognised, while the unquoted command line
// exits 0. So the line is assembled unquoted and only arguments that contain whitespace are quoted.
// A failure in the install steps used to print only "install failed", which is a dead end on a machine nobody can
// debug interactively: say which call failed, with the status, the error code and the tail of the CLI's own pnpm log.
const why = r => {
  if (r.status === 0) return 'exit 0'
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
  const logPath = /((?:[A-Za-z]:\\|\/)[^\s"']*\.plugin-manager[\\/]logs[\\/][^\s"']*pnpm\.log)/.exec(text)?.[1]
  const tail = logPath && existsSync(logPath) ? ` | log: ${readFileSync(logPath, 'utf8').trim().split('\n').slice(-3).join(' ').slice(0, 200)}` : ''
  return `status=${r.status} error=${r.error?.code ?? '-'} ${text.split('\n').slice(-3).join(' ').slice(0, 220)}${tail}`
}

const quoteForCmd = a => (/[\s"]/.test(String(a)) ? `"${a}"` : String(a))

const runCmd = (command, args, options) => process.platform === 'win32'
  ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')], { ...options, windowsVerbatimArguments: true })
  : spawnSync(command, args, options)

// The plugin carries a collector for macOS only. On a machine without one (Windows, or a checkout that has not
// built it) the Host starts, reports collector-exited and stops at a boundary - honest, but it exercises less than
// the machine can. Set COLLECTOR_EXECUTABLE to the binary and the runs use it.
const collectorLine = process.env.COLLECTOR_EXECUTABLE
  ? `    collectorExecutable: ${process.env.COLLECTOR_EXECUTABLE}\n`
  : ''

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)
const cli = process.env.DSH_CLI ?? 'dsh'
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(REPO, '.debug', 'e2e-editor', `run-${stamp}`)
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
const record = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const home = path.join(os.tmpdir(), `dsh-editor-${path.basename(artifacts)}`)
const web = 19980 + Math.floor(Math.random() * 15)
const companion = web + 1
rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
// The install steps keep the real HOME (pnpm's store lives there); only the Host runs with HOME pointed at the
// throwaway directory, because the editor bootstrap is staged under $HOME/.dsh/computer-history and the editor
// installer shells out to the operator's `code`. That is what makes the pairing route safe to call from a test:
// it can neither write into a real home nor touch a real editor.
const env = { ...process.env, DSH_HOME: home }
// HOME *and* USERPROFILE: os.homedir() follows HOME on POSIX and USERPROFILE on Windows, so setting only HOME
// would leave the Windows run staging its pairing token into the operator's real home - measured 2026-10-06 with
// `HOME=/tmp/fake-home node -e "require('node:os').homedir()"`.
const hostEnv = { ...env, HOME: home, USERPROFILE: home }
let host

try {
  const add = spec => {
    allowBuildsOff(path.join(home, 'profiles', 'editor', 'pnpm-workspace.yaml'))
    let r = runCmd(cli, ['plugin', '--profile', 'editor', 'add', spec], { env, encoding: 'utf8' })
    if (r.status !== 0) {
      const workspace = path.join(home, 'profiles', 'editor', 'pnpm-workspace.yaml')
      if (existsSync(workspace)) allowBuildsOff(workspace)
      r = runCmd(cli, ['plugin', '--profile', 'editor', 'add', spec], { env, encoding: 'utf8' })
    }
    return r
  }
  const packed = runCmd('pnpm', ['pack', '--pack-destination', home], { encoding: 'utf8' })
  record('pack', packed.status === 0, packed.status === 0 ? 'the package tarball exists' : why(packed))
  if (packed.status !== 0) throw new Error('pack failed')
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const webApp = add('@deepseek-ai/dsh-web-app@0.2.0-rc.2')
  const plugin = add(path.join(home, `dsh-computer-history-${version}.tgz`))
  const ok = webApp.status === 0 && plugin.status === 0
  record('install', ok, ok ? 'the throwaway profile has the plugin' : `web-app: ${why(webApp)}; plugin: ${why(plugin)}`)
  if (!ok) throw new Error('install failed')
  {
    const manifestPath = path.join(home, 'profiles', 'editor', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.dsh = { ...manifest.dsh, profile: { bundles: [...new Set([...(manifest.dsh?.profile?.bundles ?? []), ...Object.keys(manifest.dependencies ?? {})])] } }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(path.join(home, 'profiles', 'editor', 'cordis.patch.yml'),
      `- id: computer-history\n  config:\n    enabled: true\n    dataDirectory: ${path.join(home, 'computer-history')}\n    companionPort: ${companion}\n${collectorLine}    collectorRestart: false\n`)
  }

  host = spawnCmd(cli, ['--profile', 'editor', '--port', String(web), '--no-open'], { env: hostEnv, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let out = ''
  host.stdout.on('data', c => { out += c }); host.stderr.on('data', c => { out += c })
  for (let i = 0; i < 40 && !/token=/.test(out); i++) await sleep(1000)
  const sessionToken = /token=([A-Za-z0-9_-]+)/.exec(out)?.[1]
  writeFileSync(path.join(artifacts, 'host.log'), out)
  if (sessionToken === undefined) throw new Error('the Host never started; see host.log')
  const api = `http://127.0.0.1:${web}/api/computer-history`
  const jar = path.join(artifacts, 'cookies.txt')
  // Not /dev/null: that path does not exist on Windows. Write the landing page into the artifacts instead - the
  // same single call, and the response is kept as evidence.
  spawnSync('curl', ['-s', '-c', jar, '-o', path.join(artifacts, 'bootstrap.html'), `http://127.0.0.1:${web}/?token=${sessionToken}`])

  // GET reports what the Host could install; POST runs the installer and rotates the editor token into
  // $HOME/.dsh/computer-history. Both are safe here only because HOME points at the throwaway directory above.
  const capability = JSON.parse(spawnSync('curl', ['-s', '-b', jar, `${api}/companion/editor`], { encoding: 'utf8' }).stdout)
  writeFileSync(path.join(artifacts, 'editor-capability.json'), `${JSON.stringify(capability, null, 2)}\n`)
  record('installer capability (reported, not asserted)', true, `available=${capability.available} installed=${capability.installed} reason=${capability.reason ?? '(none)'}`)

  const send = (body, bearer) => {
    const r = spawnSync('curl', ['-s', '-w', '\n%{http_code}', '-X', 'POST',
      `http://127.0.0.1:${companion}/companion/observation`,
      '-H', 'content-type: application/json', '-H', `x-companion-token: ${bearer}`,
      '--data-binary', JSON.stringify(body)], { encoding: 'utf8' }).stdout
    const status = Number(r.trim().split('\n').pop())
    let parsed
    try { parsed = JSON.parse(r.slice(0, r.lastIndexOf('\n'))) } catch { parsed = r.slice(0, 120) }
    return { status, body: parsed }
  }
  const editorPayload = (extra = {}) => ({
    source: 'editor',
    app: { bundleId: 'com.jetbrains.intellij', name: 'IntelliJ IDEA' },
    workspaceRoot: '/tmp/e2e-editor-workspace',
    filePath: '/tmp/e2e-editor-workspace/src/Main.kt',
    languageId: 'kotlin',
    surfaceKind: 'editor',
    title: 'Main.kt',
    editorSession: 'e2e-editor-1',
    seq: 1,
    observedAtMs: Date.now(),
    ...extra,
  })

  // A cell that needs no editor token: the browser's session token cannot speak for an editor. The intake
  // authenticates before it validates, so this is also the reason the payload cells below need a token.
  const asBrowser = send(editorPayload(), sessionToken ?? '')
  record('the browser token cannot speak for an editor', asBrowser.status === 401 || asBrowser.status === 403, `HTTP ${asBrowser.status} ${JSON.stringify(asBrowser.body).slice(0, 70)}`)

  // The payload cells need the editor's own token. Ask for it rather than manufacturing one: the only route that
  // issues one stages it into the operator's home directory.
  // Ask the Host for the token the way an editor client does: POST rotates it and stages the bootstrap file.
  const install = JSON.parse(spawnSync('curl', ['-s', '-b', jar, '-X', 'POST', `${api}/companion/editor`], { encoding: 'utf8' }).stdout)
  writeFileSync(path.join(artifacts, 'editor-install.json'), `${JSON.stringify(install, null, 2)}\n`)
  const stagedDir = path.join(home, '.dsh', 'computer-history')
  let editorToken = process.env.DSH_EDITOR_TOKEN ?? ''
  for (let i = 0; i < 10 && editorToken === ''; i += 1) {
    try {
      for (const name of readdirSync(stagedDir)) {
        const candidate = JSON.parse(readFileSync(path.join(stagedDir, name), 'utf8')).token
        if (typeof candidate === 'string' && candidate.length >= 32) { editorToken = candidate; break }
      }
    } catch { /* not staged yet */ }
    if (editorToken === '') await sleep(500)
  }
  record('editor bootstrap staged', editorToken !== '', editorToken === '' ? 'no token under the throwaway home' : 'token read from the Host\'s own bootstrap file')
  if (editorToken === '') {
    record('editor token', false, 'the Host did not stage one; pass --editor-token to use another Host\'s')
  } else {
    const control = send(editorPayload(), editorToken)
    const refusedForOwnership = control.body?.reason === 'capture-not-owned'
    record('control: an editor payload is stored', control.status === 201 && control.body?.stored === true,
      refusedForOwnership
        ? 'HTTP 202 capture-not-owned: the payload arrived and was refused by name, because another Host on this machine owns capture'
        : `HTTP ${control.status} ${JSON.stringify(control.body).slice(0, 90)}`)
    const db = path.join(home, 'computer-history', 'history.sqlite')
    // node:sqlite rather than the `sqlite3` CLI: the CLI does not exist on Windows, and the objective names that
    // machine. The repository already reads stores this way (scripts/verify/chrome-companion.mjs).
    let row = ''
    try {
      const store = new DatabaseSync(db, { readOnly: true })
      const found = store.prepare('select workspace_root, surface_kind, bundle_id from observations limit 1').get()
      store.close()
      if (found) row = Object.values(found).join('|')
    } catch { row = '' }
    if (refusedForOwnership) {
      console.log('  – not run: the store cell needs this Host to own capture; another Host on this machine holds it')
    } else {
      record('the row carries the workspace, not a guess', row.includes('/tmp/e2e-editor-workspace') && row.includes('editor'), row || '(no row)')
    }
    const withText = send(editorPayload({ seq: 3, text: 'secret document body' }), editorToken)
    const said = String(withText.body?.reason ?? withText.body?.error ?? '')
    record('document text is inexpressible, and refused by name', withText.status === 400 && said.includes('unknown field for an editor payload: text'), `HTTP ${withText.status} ${JSON.stringify(withText.body).slice(0, 110)}`)
  }

  writeFileSync(path.join(artifacts, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`)
} catch (error) {
  record('run', false, error instanceof Error ? error.message : String(error))
} finally {
  if (host?.pid !== undefined) killTree(host.pid)
  await sleep(2000)
  try { rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch (error) {
    // Never let a cleanup that Windows still has a handle on replace the run's real result.
    console.error(`warning: the throwaway home is still there (${error instanceof Error ? error.message : error})`)
  }
}

const failed = checks.filter(c => !c.ok)
console.log(`\nartifacts: ${path.relative(REPO, artifacts)}`)
const ownershipBoundary = failed.every(c => c.detail.includes('capture-not-owned')) && failed.length > 0
if (ownershipBoundary) {
  console.error('\ne2e (editor wire format) stopped at a boundary, not a defect: this machine already has a Host')
  console.error('that owns capture, so the isolated Host refused the payload by name. Every cell that does not need')
  console.error('that ownership passed - the contract itself is intact. Quit the other Host, or run the matrix')
  console.error('against the one that owns capture.')
  process.exit(1)
}
if (failed.length > 0) {
  console.error(`e2e (editor wire format) failed: ${failed.map(c => `${c.name} (${c.detail})`).join('; ')}`)
  process.exit(1)
}
console.log(`e2e (editor wire format) passed: ${checks.length} checks - the contract the JetBrains client implements`)
