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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)
const cli = process.env.DSH_CLI ?? 'dsh'
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(REPO, '.debug', 'e2e-editor', `run-${stamp}`)
mkdirSync(artifacts, { recursive: true })
const checks = []
const record = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const home = path.join(os.tmpdir(), `dsh-editor-${path.basename(artifacts)}`)
const web = 19980 + Math.floor(Math.random() * 15)
const companion = web + 1
rmSync(home, { recursive: true, force: true })
// The install steps keep the real HOME (pnpm's store lives there); only the Host runs with HOME pointed at the
// throwaway directory, because the editor bootstrap is staged under $HOME/.dsh/computer-history and the editor
// installer shells out to the operator's `code`. That is what makes the pairing route safe to call from a test:
// it can neither write into a real home nor touch a real editor.
const env = { ...process.env, DSH_HOME: home }
const hostEnv = { ...env, HOME: home }
let host

try {
  const add = spec => {
    let r = spawnSync(cli, ['plugin', '--profile', 'editor', 'add', spec], { env, encoding: 'utf8' })
    if (r.status !== 0) {
      const workspace = path.join(home, 'profiles', 'editor', 'pnpm-workspace.yaml')
      if (existsSync(workspace)) writeFileSync(workspace, readFileSync(workspace, 'utf8').replaceAll(': set this to true or false', ': false'))
      r = spawnSync(cli, ['plugin', '--profile', 'editor', 'add', spec], { env, encoding: 'utf8' })
    }
    return r
  }
  spawnSync('pnpm', ['pack', '--pack-destination', home])
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const ok = add('@deepseek-ai/dsh-web-app@0.2.0-rc.2').status === 0 && add(path.join(home, `dsh-computer-history-${version}.tgz`)).status === 0
  record('install', ok, ok ? 'the throwaway profile has the plugin' : 'install failed')
  if (!ok) throw new Error('install failed')
  {
    const manifestPath = path.join(home, 'profiles', 'editor', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.dsh = { ...manifest.dsh, profile: { bundles: [...new Set([...(manifest.dsh?.profile?.bundles ?? []), ...Object.keys(manifest.dependencies ?? {})])] } }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(path.join(home, 'profiles', 'editor', 'cordis.patch.yml'),
      `- id: computer-history\n  config:\n    enabled: true\n    dataDirectory: ${path.join(home, 'computer-history')}\n    companionPort: ${companion}\n    collectorRestart: false\n`)
  }

  host = spawn(cli, ['--profile', 'editor', '--port', String(web), '--no-open'], { env: hostEnv, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let out = ''
  host.stdout.on('data', c => { out += c }); host.stderr.on('data', c => { out += c })
  for (let i = 0; i < 40 && !/token=/.test(out); i++) await sleep(1000)
  const sessionToken = /token=([A-Za-z0-9_-]+)/.exec(out)?.[1]
  writeFileSync(path.join(artifacts, 'host.log'), out)
  if (sessionToken === undefined) throw new Error('the Host never started; see host.log')
  const api = `http://127.0.0.1:${web}/api/computer-history`
  const jar = path.join(artifacts, 'cookies.txt')
  spawnSync('curl', ['-s', '-c', jar, '-o', '/dev/null', `http://127.0.0.1:${web}/?token=${sessionToken}`])

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
    const row = spawnSync('sqlite3', [db, 'select workspace_root, surface_kind, bundle_id from observations limit 1;'], { encoding: 'utf8' }).stdout.trim()
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
  if (host?.pid !== undefined) { try { process.kill(-host.pid, 'SIGTERM') } catch {} }
  await sleep(2000)
  rmSync(home, { recursive: true, force: true })
}

const failed = checks.filter(c => !c.ok)
console.log(`\nartifacts: ${path.relative(REPO, artifacts)}`)
if (failed.length > 0) {
  console.error(`e2e (editor wire format) failed: ${failed.map(c => `${c.name} (${c.detail})`).join('; ')}`)
  process.exit(1)
}
console.log(`e2e (editor wire format) passed: ${checks.length} checks - the contract the JetBrains client implements`)
