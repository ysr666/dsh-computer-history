#!/usr/bin/env node
/* oxlint-disable no-await-in-loop -- this script drives a real packaged UI step by step */
// Three-platform installed-client acceptance for the release artifact.
//
// DSH_E2E_TARBALL=<assembled three-platform tgz> pnpm e2e:packaged-client
//
// This is deliberately stronger than a component render:
//   1. create a throwaway DSH profile;
//   2. install the real web app + exact plugin tarball with `dsh plugin add`;
//   3. boot the real Host from that profile;
//   4. launch a real headless Chrome against the Host's one-time token URL;
//   5. prove the installed client module was fetched, the sidebar panel mounts,
//      first-run renders, History/Privacy API reads come from the browser, and
//      the installed Settings surface is reachable.
//
// No checkout symlink/junction and no collectorExecutable override are used.
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

const tarball = process.env.DSH_E2E_TARBALL
if (!tarball) {
  console.error('DSH_E2E_TARBALL is required: point it at the assembled three-platform plugin tarball')
  process.exit(2)
}
const resolvedTarball = path.resolve(tarball)
if (!existsSync(resolvedTarball)) {
  console.error(`DSH_E2E_TARBALL does not exist: ${resolvedTarball}`)
  process.exit(2)
}

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)

const cli = process.env.DSH_CLI ?? 'dsh'
const profile = 'packaged-client'
const home = mkdtempSync(path.join(os.tmpdir(), 'dch-packaged-client-'))
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(
  REPO,
  '.debug',
  'e2e-packaged-client',
  `${process.platform}-${stamp}`,
)
mkdirSync(artifacts, { recursive: true })

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const quoteForCmd = value => (/[\s"]/.test(String(value)) ? `"${value}"` : String(value))
const run = (command, args, options = {}) => {
  const shim = process.platform === 'win32' && ['dsh', 'pnpm', 'npx'].includes(command)
  const result = shim
    ? spawnSync(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')],
        { encoding: 'utf8', ...options, windowsVerbatimArguments: true },
      )
    : spawnSync(command, args, { encoding: 'utf8', ...options })
  const errorText = result.error
    ? `\nspawn error: ${result.error.code ?? result.error.name}: ${result.error.message}`
    : ''
  return {
    status: result.status ?? 1,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}${errorText}`,
  }
}
const spawnCommand = (command, args, options) => {
  if (process.platform === 'win32' && command === cli) {
    return spawn(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')],
      { ...options, windowsVerbatimArguments: true },
    )
  }
  return spawn(command, args, options)
}
const killTree = pid => {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', `taskkill /pid ${pid} /T /F`],
      { stdio: 'ignore' },
    )
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
  }
}

const allowBuildsOff = workspace => {
  try {
    if (!existsSync(workspace)) return false
    const current = readFileSync(workspace, 'utf8')
    const next = current.replace(
      /^(\s+[^\s:]+:\s*)set this to true or false\s*$/gm,
      '$1false',
    )
    if (next === current) return false
    writeFileSync(workspace, next)
    return true
  } catch {
    return false
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer()
  server.unref()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : undefined
    server.close(error => {
      if (error) reject(error)
      else if (!port) reject(new Error('failed to allocate a loopback port'))
      else resolve(port)
    })
  })
})

const chromeCandidates = () => {
  const configured = process.env.PANEL_CHROME ? [process.env.PANEL_CHROME] : []
  if (process.platform === 'darwin') {
    return [
      ...configured,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
  }
  if (process.platform === 'win32') {
    return [
      ...configured,
      process.env.PROGRAMFILES
        ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      process.env['PROGRAMFILES(X86)']
        ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
    ].filter(Boolean)
  }
  return [
    ...configured,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
}
const chrome = chromeCandidates().find(candidate => existsSync(candidate))
if (!chrome) {
  console.error(`no supported Chrome/Chromium binary found; checked: ${chromeCandidates().join(', ')}`)
  process.exit(1)
}

const connectCdp = async cdpPort => {
  let targets
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      if (response.ok) {
        targets = await response.json()
        break
      }
    } catch {
      // Browser is still starting.
    }
    await sleep(250)
  }
  const page = targets?.find(target => target.type === 'page')
  if (!page) throw new Error('headless Chrome did not expose a page target')

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const events = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) call.reject(new Error(JSON.stringify(message.error)))
      else call.resolve(message.result)
      return
    }
    if (message.method) events.push(message)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('DevTools socket refused to open')), { once: true })
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id
    pending.set(messageId, { resolve, reject })
    socket.send(JSON.stringify({ id: messageId, method, params }))
  })
  return { socket, send, events }
}

let host
let browser
let hostOutput = ''

try {
  const version = run(cli, ['--version'])
  record(
    'supported DSH CLI',
    version.status === 0,
    version.status === 0 ? version.out.trim().split('\n')[0] : version.out.trim().slice(-200),
  )
  if (version.status !== 0) throw new Error('dsh CLI is not runnable')

  const env = { ...process.env, DSH_HOME: home }
  for (const spec of ['@deepseek-ai/dsh-web-app@0.2.0-rc.2', resolvedTarball]) {
    const workspace = path.join(home, 'profiles', profile, 'pnpm-workspace.yaml')
    allowBuildsOff(workspace)
    let added = run(cli, ['plugin', '--profile', profile, 'add', spec], { env })
    if (added.status !== 0) {
      allowBuildsOff(workspace)
      added = run(cli, ['plugin', '--profile', profile, 'add', spec], { env })
    }
    const label = spec === resolvedTarball ? 'install packaged Computer History' : 'install DSH web app'
    record(label, added.status === 0, added.status === 0 ? 'exit 0' : added.out.trim().slice(-320))
    if (added.status !== 0) throw new Error(`${label} failed`)
  }

  const profileManifestPath = path.join(home, 'profiles', profile, 'package.json')
  const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
  const dependencies = Object.keys(profileManifest.dependencies ?? {})
  const bundles = profileManifest.dsh?.profile?.bundles ?? []
  const pluginRegistered =
    dependencies.includes('dsh-computer-history')
    && bundles.includes('dsh-computer-history')
  record(
    'CLI registered packaged Computer History as a bundle',
    pluginRegistered,
    `dependencies=[${dependencies.join(', ')}] bundles=[${bundles.join(', ')}]`,
  )
  if (!pluginRegistered) {
    throw new Error('clean plugin add did not register Computer History as a profile bundle')
  }
  if (!dependencies.includes('@deepseek-ai/dsh-web-app')) {
    throw new Error('the throwaway profile does not contain the DSH web app dependency')
  }

  // A profile created only by the CLI does not automatically put dsh-web-app in its layer list.
  // That is a Host-shell fixture limitation already measured by e2e-macos, not plugin wiring.
  // Bootstrap only the shell layer here. Computer History itself is deliberately never repaired:
  // the assertion above proves dsh plugin add registered it before this write happens.
  if (!bundles.includes('@deepseek-ai/dsh-web-app')) {
    const shellBundles = [...new Set([...bundles, '@deepseek-ai/dsh-web-app'])]
    profileManifest.dsh = {
      ...profileManifest.dsh,
      profile: {
        ...profileManifest.dsh?.profile,
        bundles: shellBundles,
      },
    }
    writeFileSync(
      profileManifestPath,
      `${JSON.stringify(profileManifest, null, 2)}\n`,
    )
    record(
      'bootstrap throwaway profile web shell',
      true,
      'added @deepseek-ai/dsh-web-app only; Computer History bundle entry was already present',
    )
  } else {
    record('bootstrap throwaway profile web shell', true, 'web app layer already present')
  }

  const installedRoot = path.join(
    home,
    'profiles',
    profile,
    'node_modules',
    'dsh-computer-history',
  )
  const installedPackage = JSON.parse(
    readFileSync(path.join(installedRoot, 'package.json'), 'utf8'),
  )
  record(
    'installed package exposes client entry',
    installedPackage.exports?.['./client']?.default === './lib/client.js'
      && installedPackage.dsh?.client?.platform === 'web',
    `client=${installedPackage.exports?.['./client']?.default ?? '(missing)'} platform=${installedPackage.dsh?.client?.platform ?? '(missing)'}`,
  )

  const webPort = await freePort()
  const companionPort = await freePort()
  const cdpPort = await freePort()
  writeFileSync(
    path.join(home, 'profiles', profile, 'cordis.patch.yml'),
    `# Packaged client acceptance: product config only; package wiring comes from dsh plugin add.
- id: computer-history
  config:
    enabled: true
    dataDirectory: ${path.join(home, 'computer-history')}
    companionPort: ${companionPort}
    collectorRestart: false
`,
  )

  host = spawnCommand(cli, ['--profile', profile, '--port', String(webPort), '--no-open'], {
    env,
    cwd: os.tmpdir(),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  host.stdout?.on('data', chunk => { hostOutput += String(chunk) })
  host.stderr?.on('data', chunk => { hostOutput += String(chunk) })

  const hostDeadline = Date.now() + 90_000
  let token = ''
  while (Date.now() < hostDeadline) {
    token = /token=([A-Za-z0-9_-]+)/.exec(hostOutput)?.[1] ?? ''
    if (token) break
    if (host.exitCode !== null) break
    await sleep(500)
  }
  writeFileSync(path.join(artifacts, 'host.log'), hostOutput)
  record('Host restarts from installed profile', token !== '', token ? `port ${webPort}` : 'no token line within 90s')
  if (!token) throw new Error('installed profile Host did not start')

  const chromeProfile = path.join(home, 'chrome-profile')
  browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${chromeProfile}`,
    '--no-first-run',
    '--disable-dev-shm-usage',
    '--window-size=1440,1000',
    'about:blank',
  ], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  })

  const { socket, send, events } = await connectCdp(cdpPort)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })

  const evaluate = async expression =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value

  await send('Page.navigate', { url: `http://127.0.0.1:${webPort}/?token=${token}` })
  await sleep(10_000)

  const dismissDialogs = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const visible = Number(await evaluate(
        "document.querySelectorAll('[role=\"dialog\"],dialog').length",
      ))
      if (visible === 0) return
      await evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"],dialog')
        if (!dialog) return 'none'
        const buttons = [...dialog.querySelectorAll('button')].filter(button => button.getClientRects().length)
        const preferred = buttons.find(button => /^(稍后配置|稍后|继续|知道了|关闭|Later|Continue|Got it|Close|Skip|Not now|×)$/i.test((button.textContent || '').trim()))
        const button = preferred ?? buttons.at(-1)
        if (!button) return 'none'
        button.click()
        return 'clicked'
      })()`)
      await sleep(700)
    }
  }
  const clickMatching = async patterns => evaluate(`(() => {
    const patterns = ${JSON.stringify(patterns)}.map(value => new RegExp(value, 'i'))
    const nodes = [...document.querySelectorAll('button,[role="button"],a,li,[role="tab"],[role="menuitem"],[data-slot]')]
      .filter(node => node.getClientRects().length > 0)
    const matches = nodes.filter(node => {
      const text = (node.textContent || '').trim()
      const label = node.getAttribute('aria-label') || ''
      const title = node.getAttribute('title') || ''
      return patterns.some(pattern => pattern.test(text) || pattern.test(label) || pattern.test(title))
    }).toSorted((a, b) => (a.textContent || '').length - (b.textContent || '').length)
    const target = matches[0]
    if (!target) return 'missing'
    target.click()
    return 'clicked'
  })()`)

  await dismissDialogs()

  const bootEntry = await evaluate(`(() => {
    const entries = window.__DSH_BOOT__?.entries
    if (!Array.isArray(entries)) return null
    const entry = entries.find(item => item?.id === 'dsh-computer-history')
    return entry ? { id: entry.id, url: entry.url, inject: entry.inject } : null
  })()`)
  record(
    'web app boot discovers installed client',
    bootEntry?.id === 'dsh-computer-history' && typeof bootEntry?.url === 'string',
    bootEntry ? JSON.stringify(bootEntry) : 'no dsh-computer-history boot entry',
  )

  const openPanel = async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await evaluate("!!document.querySelector('.ch-main')")) return true
      await clickMatching(['^电脑使用记录$', '^Computer History$'])
      await sleep(900)
      if (await evaluate("!!document.querySelector('.ch-main')")) return true

      // Some shell compositions keep plugin panels behind the plugin menu.
      await clickMatching(['^插件$', '^Plugins?$', '^Plugin$'])
      await sleep(700)
      await clickMatching(['^电脑使用记录$', '^Computer History$'])
      await sleep(900)
      if (await evaluate("!!document.querySelector('.ch-main')")) return true

      // The main panel area may not exist until a session is opened.
      await clickMatching(['^新会话$', '^新对话$', '^New chat$', '^New session$'])
      await sleep(900)
      await dismissDialogs()
    }
    return false
  }

  const panelOpened = await openPanel()
  record(
    'installed sidebar opens Computer History Main',
    panelOpened,
    panelOpened ? '.ch-main mounted' : 'sidebar entry did not mount .ch-main',
  )
  if (!panelOpened) throw new Error('installed Computer History panel did not open')

  await sleep(4_000)

  const firstRun = Boolean(await evaluate("!!document.querySelector('.ch-first-run')"))
  record(
    'fresh installed package renders first-run state',
    firstRun,
    firstRun ? '.ch-first-run visible' : 'first-run surface missing',
  )

  const responses = events
    .filter(event => event.method === 'Network.responseReceived')
    .map(event => ({
      url: event.params?.response?.url ?? '',
      status: event.params?.response?.status ?? 0,
      type: event.params?.type ?? '',
    }))
  const clientResponse = responses.find(item =>
    item.url.includes('computer-history')
    && item.url.includes('/plugins/')
    && item.status >= 200
    && item.status < 300
  )
  record(
    'installed client module fetched successfully',
    Boolean(clientResponse),
    clientResponse
      ? `${clientResponse.status} ${clientResponse.url}`
      : 'no successful /plugins/*computer-history* response captured',
  )

  const requiredReads = ['/state', '/policy', '/retention']
  const apiEvidence = requiredReads.map(suffix => {
    const match = responses.find(item =>
      item.url.includes(`/api/computer-history${suffix}`)
      && item.status >= 200
      && item.status < 300
    )
    return { suffix, ok: Boolean(match), status: match?.status, url: match?.url }
  })
  record(
    'packaged History/Privacy client reaches Host API',
    apiEvidence.every(item => item.ok),
    apiEvidence.map(item => `${item.suffix}=${item.status ?? 'missing'}`).join(' '),
  )

  const openSettings = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await clickMatching(['^设置$', '^Settings$'])
      await sleep(1_100)
      const dialog = Boolean(await evaluate(
        "!![...document.querySelectorAll('[role=\"dialog\"],dialog')].find(node => node.getClientRects().length)",
      ))
      if (!dialog) continue

      // Pick the plugin's own settings nav item, preferring the last exact match
      // because the sidebar entry may still exist behind the modal.
      const clicked = await evaluate(`(() => {
        const wanted = ['电脑使用记录', 'Computer History']
        const nodes = [...document.querySelectorAll('button,a,li,[role="tab"],[role="menuitem"],[data-slot]')]
          .filter(node => node.getClientRects().length > 0)
          .filter(node => wanted.includes((node.textContent || '').trim()))
        const target = nodes.at(-1)
        if (!target) return false
        target.click()
        const owner = target.closest('button,[role="tab"],[role="menuitem"],li,a,[data-slot]')
        if (owner && owner !== target) owner.click()
        return true
      })()`)
      if (!clicked) continue
      await sleep(1_300)
      if (Number(await evaluate("document.querySelectorAll('.ch-settings-item').length")) > 0) return true
    }
    return false
  }

  const settingsOpened = await openSettings()
  const settingsRows = Number(
    await evaluate("document.querySelectorAll('.ch-settings-item').length"),
  )
  record(
    'installed Settings / History & Privacy surface appears',
    settingsOpened && settingsRows > 0,
    `${settingsRows} .ch-settings-item row(s)`,
  )

  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(
    path.join(artifacts, 'installed-client.png'),
    Buffer.from(screenshot.data, 'base64'),
  )
  writeFileSync(
    path.join(artifacts, 'browser-text.txt'),
    String(await evaluate("document.body.innerText || ''")),
  )
  writeFileSync(
    path.join(artifacts, 'network.json'),
    `${JSON.stringify(responses.filter(item =>
      item.url.includes('computer-history')
      || item.url.includes('/plugins/')), null, 2)}\n`,
  )
  writeFileSync(
    path.join(artifacts, 'evidence.json'),
    `${JSON.stringify({ platform: process.platform, bootEntry, apiEvidence, checks }, null, 2)}\n`,
  )

  socket.close()

  const failures = checks.filter(check => !check.ok)
  if (failures.length > 0) {
    throw new Error(`${failures.length} packaged-client acceptance check(s) failed`)
  }

  console.log(
    `packaged client acceptance holds on ${process.platform}: installed client fetched, Main + first-run + Settings rendered, History/Privacy reads reached the Host`,
  )
} catch (error) {
  writeFileSync(path.join(artifacts, 'host.log'), hostOutput)
  writeFileSync(
    path.join(artifacts, 'evidence.json'),
    `${JSON.stringify({ platform: process.platform, checks, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  )
  console.error(
    `packaged client acceptance failed on ${process.platform}: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
} finally {
  if (browser?.pid) killTree(browser.pid)
  if (host?.pid) killTree(host.pid)
  await sleep(1_500)
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    console.error(
      `warning: throwaway packaged-client home remains: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
