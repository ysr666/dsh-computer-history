#!/usr/bin/env node
/* oxlint-disable no-await-in-loop -- browser automation is intentionally sequential */
// Release-grade product-path verification for an already-running throwaway DSH Host.
//
// Required:
//   PANEL_URL=http://127.0.0.1:<port>/
//   PANEL_COOKIE_JAR=<Netscape cookie jar produced by the Host bootstrap request>
//
// Optional:
//   PANEL_OUT=<artifact directory>
//   PANEL_CHROME=<Chrome/Edge executable>
//   PANEL_CDP_PORT=<DevTools port>
//
// This script does not mock Computer History APIs. It loads the installed client bundle through the real DSH web
// shell, opens the real sidebar panel and Settings section, and records the network responses that prove the
// installed browser client talked to the installed Host.
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const panelUrl = process.env.PANEL_URL?.trim()
const cookieJar = process.env.PANEL_COOKIE_JAR?.trim()
if (!panelUrl || !cookieJar) {
  console.error('PANEL_URL and PANEL_COOKIE_JAR are required')
  process.exit(2)
}
if (!existsSync(cookieJar)) {
  console.error(`PANEL_COOKIE_JAR does not exist: ${cookieJar}`)
  process.exit(2)
}

const outDir = path.resolve(
  process.env.PANEL_OUT?.trim()
  || path.join('.debug', 'installed-client'),
)
const cdpPort = Number(process.env.PANEL_CDP_PORT ?? (19320 + Math.floor(Math.random() * 300)))
const profileDir = path.join(outDir, 'chrome-profile')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const panelLabels = ['Computer History', '电脑使用记录']

mkdirSync(outDir, { recursive: true })

function browserCandidates() {
  if (process.env.PANEL_CHROME?.trim()) return [process.env.PANEL_CHROME.trim()]
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean)
    return [
      ...roots.map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map(root => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ]
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ]
}

const browserPath = browserCandidates().find(candidate => existsSync(candidate))
if (!browserPath) {
  console.error(`no Chromium browser found; checked: ${browserCandidates().join(', ')}`)
  process.exit(2)
}

function parseCookies(file) {
  const result = []
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!rawLine) continue
    if (rawLine.startsWith('#') && !rawLine.startsWith('#HttpOnly_')) continue
    const line = rawLine.replace(/^#HttpOnly_/, '')
    const fields = line.split('\t')
    if (fields.length < 7) continue
    const [domain, , cookiePath, secure, expires, name, ...valueParts] = fields
    const value = valueParts.join('\t')
    if (!name || !value) continue
    result.push({
      domain,
      path: cookiePath || '/',
      secure: secure === 'TRUE',
      expires: Number(expires) || undefined,
      name,
      value,
    })
  }
  return result
}

const cookies = parseCookies(cookieJar)
if (cookies.length === 0) {
  console.error('the bootstrap cookie jar contains no usable cookies')
  process.exit(2)
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
  try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
}

rmSync(profileDir, { recursive: true, force: true })
const browser = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--disable-dev-shm-usage',
  '--window-size=1600,1200',
  'about:blank',
], { stdio: 'ignore' })

const evidence = {
  platform: process.platform,
  browser: path.basename(browserPath),
  client: {},
  main: {},
  settings: {},
  api: {},
}
const responses = []
let socket

const finish = (ok, message) => {
  writeFileSync(
    path.join(outDir, 'evidence.json'),
    `${JSON.stringify({ ...evidence, ok, message }, null, 2)}\n`,
  )
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  killTree(browser.pid)
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  if (!ok) {
    console.error(message)
    process.exit(1)
  }
  console.log(message)
}

try {
  let targets
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      if (response.ok) {
        targets = await response.json()
        break
      }
    } catch { /* browser still starting */ }
    await sleep(400)
  }
  const page = targets?.find(target => target.type === 'page')
  if (!page) throw new Error('headless Chromium did not expose a page target')

  socket = new WebSocket(page.webSocketDebuggerUrl)
  let callId = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }
    if (message.method === 'Network.responseReceived') {
      responses.push({
        url: message.params.response.url,
        status: message.params.response.status,
        mimeType: message.params.response.mimeType,
      })
    }
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('DevTools socket failed to open')), { once: true })
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++callId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value
  const screenshot = async name => {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'))
  }
  const visible = selector =>
    evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); return !!n && n.getClientRects().length > 0 })()`)
  const clickText = async (labels, scope = 'document') => {
    const wanted = Array.isArray(labels) ? labels : [labels]
    return evaluate(`(() => {
      const root = ${scope}
      if (!root) return 'missing-scope'
      const wanted = ${JSON.stringify(wanted)}
      const nodes = [...root.querySelectorAll('button,[role="button"],[role="menuitem"],[role="tab"],a,li,[data-slot],summary')]
        .filter(node => node.getClientRects().length > 0)
        .filter(node => {
          const text = (node.textContent || '').trim()
          const aria = node.getAttribute('aria-label') || ''
          const title = node.getAttribute('title') || ''
          return wanted.some(label => text.includes(label) || aria.includes(label) || title.includes(label))
        })
        .toSorted((a, b) => (a.textContent || '').length - (b.textContent || '').length)
      if (!nodes[0]) return 'missing'
      nodes[0].click()
      return 'clicked'
    })()`)
  }
  const dismissDialogs = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await evaluate(`(() => {
        const dialog=[...document.querySelectorAll('[role="dialog"],dialog')]
          .find(node => node.getClientRects().length > 0)
        if(!dialog)return 'none'
        const buttons=[...dialog.querySelectorAll('button')].filter(node=>node.getClientRects().length>0)
        const button=buttons.find(node=>/^(稍后配置|稍后|继续|知道了|关闭|Later|Continue|Got it|Close|Skip|Not now|×)$/i.test((node.textContent||'').trim()))
          ?? buttons.find(node=>/close|关闭/i.test(node.getAttribute('aria-label')||''))
        if(!button)return 'blocked'
        button.click(); return 'clicked'
      })()`)
      if (result === 'none' || result === 'blocked') return
      await sleep(500)
    }
  }
  const ensureSession = async () => {
    await clickText(['新会话', '新对话', 'New chat', 'New Chat', 'Start chat', 'Start Chat'])
    await sleep(900)
  }
  const openPanel = async () => {
    if (await visible('.ch-main')) return true
    await ensureSession()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await dismissDialogs()
      await clickText(panelLabels)
      await sleep(800)
      if (await visible('.ch-main')) return true
      await clickText(['插件', 'Plugins', 'Plugin'])
      await sleep(500)
      await clickText(panelLabels)
      await sleep(1_000)
      if (await visible('.ch-main')) return true
    }
    return false
  }
  const waitFor = async (probe, attempts = 30, delayMs = 500) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await probe()) return true
      await sleep(delayMs)
    }
    return false
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })

  for (const cookie of cookies) {
    const set = await send('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: panelUrl,
      path: cookie.path,
      secure: cookie.secure,
      ...(cookie.expires === undefined ? {} : { expires: cookie.expires }),
    })
    if (set.success !== true) throw new Error(`failed to install browser session cookie ${cookie.name}`)
  }

  await send('Page.navigate', { url: panelUrl })
  await sleep(8_000)
  await dismissDialogs()

  const bootEntry = await evaluate(`(() => {
    const entries=window.__DSH_BOOT__?.entries
    if(!Array.isArray(entries))return null
    const item=entries.find(entry=>entry?.id==='dsh-computer-history')
    return item ? {id:item.id,url:item.url,inject:item.inject} : null
  })()`)
  evidence.client.bootEntry = bootEntry
  if (!bootEntry?.url) throw new Error('DSH boot entries do not include the installed dsh-computer-history client')

  const clientResponseReady = await waitFor(async () => responses.some(response =>
    response.url.includes('dsh-computer-history')
      && response.url.includes('client.js')
      && response.status === 200
  ), 20, 250)
  const clientResponse = responses.find(response =>
    response.url.includes('dsh-computer-history') && response.url.includes('client.js')
  )
  evidence.client.response = clientResponse ?? null
  if (!clientResponseReady) {
    throw new Error(`installed client bundle did not return 200 (seen: ${clientResponse?.status ?? 'no response'})`)
  }

  if (!await openPanel()) {
    const body = String(await evaluate("document.body.innerText || ''"))
    writeFileSync(path.join(outDir, 'panel-not-found.txt'), body)
    await screenshot('panel-not-found')
    throw new Error('Computer History sidebar panel did not mount from the installed package')
  }

  const mainMounted = await visible('.ch-main')
  const firstRun = await waitFor(() => visible('.ch-first-run'), 24, 500)
  const mainText = String(await evaluate("document.querySelector('.ch-main')?.innerText || ''"))
  evidence.main = {
    mounted: mainMounted,
    firstRun,
    textSample: mainText.slice(0, 500),
  }
  await screenshot('first-run')
  if (!mainMounted) throw new Error('Computer History main panel is not visible')
  if (!firstRun) throw new Error('clean installed package did not render the first-run state')

  // The shared control store supplies History & Privacy data. Require real browser responses, not direct Node/curl
  // probes, so this proves the installed client executed and talked to the installed Host.
  const apiStatus = suffix => {
    const response = responses.find(item => item.url.includes(`/api/computer-history/${suffix}`))
    return response?.status
  }
  const stateStatus = apiStatus('state')
  const policyStatus = apiStatus('policy')
  const retentionStatus = apiStatus('retention')
  evidence.api = { stateStatus, policyStatus, retentionStatus }
  if (stateStatus !== 200 || policyStatus !== 200 || retentionStatus !== 200) {
    throw new Error(
      `installed client did not complete History/Privacy reads: state=${stateStatus ?? 'none'} policy=${policyStatus ?? 'none'} retention=${retentionStatus ?? 'none'}`,
    )
  }

  await clickText(['设置', 'Settings'])
  await waitFor(
    async () => Number(await evaluate("document.querySelectorAll('[role=\"dialog\"],dialog').length")) > 0,
    20,
    300,
  )
  let settingsShown = false
  const settingsNavigation = []
  for (let attempt = 0; attempt < 5; attempt += 1) {
    for (const label of panelLabels) {
      const selected = String(await evaluate(`(() => {
        const wanted = ${JSON.stringify(label)}
        const scope = document.querySelector('[role="dialog"],dialog') ?? document
        const nodes = [...scope.querySelectorAll('button,a,li,[role],[data-slot]')]
          .filter(node => node.getClientRects().length > 0)
          .filter(node => (node.textContent || '').trim() === wanted)
        if (nodes.length === 0) return 'missing'
        const target = nodes.at(-1)
        target.click()
        const clickable = target.closest('button,[role="tab"],[role="menuitem"],li,a,[data-slot]')
        if (clickable && clickable !== target) clickable.click()
        return `clicked ${nodes.length}`
      })()`))
      settingsNavigation.push({ label, selected })
      await sleep(1_200)
      if (await visible('.ch-settings-list')) {
        settingsShown = true
        break
      }
    }
    if (settingsShown) break
  }
  const settingsReady = settingsShown && await waitFor(
    async () => !(await visible('.ch-settings-loading')),
    30,
    300,
  )
  const settingsRows = Number(await evaluate("document.querySelectorAll('.ch-settings-item').length"))
  evidence.settings = {
    shown: settingsShown,
    ready: settingsReady,
    rows: settingsRows,
    navigation: settingsNavigation,
  }
  await screenshot('settings')
  if (!settingsShown || !settingsReady || settingsRows < 1) {
    throw new Error(
      `Computer History Settings did not render ready rows (shown=${settingsShown} ready=${settingsReady} rows=${settingsRows})`,
    )
  }

  finish(
    true,
    `installed client product path passed on ${process.platform}: client 200, first-run visible, History/Privacy reads 200, Settings rows=${settingsRows}`,
  )
} catch (error) {
  try {
    // Give failures one final screenshot without making screenshot failure hide the original error.
    // The active CDP session may already be gone, so evidence.json remains the durable minimum artifact.
  } catch { /* no-op */ }
  finish(false, error instanceof Error ? error.message : String(error))
}
