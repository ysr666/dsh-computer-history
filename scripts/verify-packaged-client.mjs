#!/usr/bin/env node
// Release-grade proof that the client half of a clean-installed Computer History bundle is actually mounted
// by the DSH web app. The Host is started elsewhere; this script consumes its one-time token in a real
// headless Chromium session, opens the installed panel and Settings surface, and records the network requests
// that prove History and Privacy data came from the installed plugin rather than a screenshot fixture.
//
// Required:
//   PANEL_URL=http://127.0.0.1:<port>/?token=<one-time-token>
//
// Optional:
//   PANEL_OUT=<artifact directory>
//   PANEL_CDP_PORT=<DevTools port>
//   PANEL_CHROME=<browser executable>
//   PANEL_COOKIE_OUT=<Netscape cookie jar path for a caller that needs to keep using the same Host session>
//
// This is intentionally much smaller than verify-panel-render.mjs. The latter is a visual regression harness;
// this script is the packaged-install product gate tracked by issue #44.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

const panelUrl = process.env.PANEL_URL
if (!panelUrl) {
  console.error('PANEL_URL is required')
  process.exit(2)
}

const outDir = path.resolve(process.env.PANEL_OUT ?? '.debug/packaged-client')
const cdpPort = Number(process.env.PANEL_CDP_PORT ?? 19243)
const cookieOut = process.env.PANEL_COOKIE_OUT
const panelLabels = [process.env.PANEL_ENTRY, '电脑使用记录', 'Computer History'].filter(Boolean)
const sessionLabels = ['新会话', 'New chat', 'New conversation']
const settingsLabels = ['设置', 'Settings']
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function pathLookup(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(command, [name], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return undefined
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map(value => value.trim())
    .find(value => value && existsSync(value))
}

function browserExecutable() {
  if (process.env.PANEL_CHROME) {
    const explicit = path.resolve(process.env.PANEL_CHROME)
    if (!existsSync(explicit)) throw new Error(`PANEL_CHROME does not exist: ${explicit}`)
    return explicit
  }

  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    : process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
        ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  for (const command of process.platform === 'win32'
    ? ['chrome.exe', 'msedge.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const resolved = pathLookup(command)
    if (resolved) return resolved
  }

  throw new Error('no supported Chromium browser was found on this runner')
}

function connect(target, onRequest) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Network.requestWillBeSent') {
      const url = message.params?.request?.url
      if (typeof url === 'string') onRequest(url)
    }
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const call of pending.values()) call.reject(new Error('DevTools connection closed'))
    pending.clear()
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id
    pending.set(messageId, { resolve, reject })
    socket.send(JSON.stringify({ id: messageId, method, params }))
  })
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ send, socket }))
    socket.addEventListener('error', () => reject(new Error('DevTools socket refused to open')))
  })
}

function netscapeCookieJar(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Generated by verify-packaged-client.mjs']
  for (const cookie of cookies) {
    const domain = cookie.domain || '127.0.0.1'
    const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE'
    const secure = cookie.secure ? 'TRUE' : 'FALSE'
    const expires = Number.isFinite(cookie.expires) && cookie.expires > 0
      ? Math.floor(cookie.expires)
      : 0
    const domainField = cookie.httpOnly ? `#HttpOnly_${domain}` : domain
    lines.push([
      domainField,
      includeSubdomains,
      cookie.path || '/',
      secure,
      String(expires),
      cookie.name,
      cookie.value,
    ].join('\t'))
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const executable = browserExecutable()
  const profile = path.join(outDir, '.browser-profile')
  rmSync(profile, { recursive: true, force: true })

  const args = [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1600,1200',
    'about:blank',
  ]
  if (process.platform === 'linux') args.unshift('--no-sandbox')

  const browser = spawn(executable, args, {
    stdio: 'ignore',
    windowsHide: true,
  })

  let socket
  try {
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
      await sleep(500)
    }
    const page = targets?.find(target => target.type === 'page')
    if (!page) throw new Error('headless browser did not expose a page target')

    const requests = new Set()
    const devtools = await connect(page, requestUrl => { requests.add(requestUrl) })
    socket = devtools.socket
    const { send } = devtools
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Network.enable')
    await send('Network.setCacheDisabled', { cacheDisabled: true })

    const evaluate = async expression =>
      (await send('Runtime.evaluate', { returnByValue: true, expression })).result?.value
    const visibleCount = selector =>
      evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(node=>node.getClientRects().length>0).length`)
    const clickText = (label, { last = false } = {}) => evaluate(`(() => {
      const clickable = 'button,[role="button"],a,[data-slot],li,summary'
      const candidates = [...document.querySelectorAll(clickable)]
        .filter(node => node.getClientRects().length > 0)
        .filter(node => (node.textContent || '').includes(${JSON.stringify(label)}))
        .toSorted((a, b) => (a.textContent || '').length - (b.textContent || '').length)
      const target = candidates${last ? '.at(-1)' : '[0]'}
      if (!target) return 'missing'
      target.click()
      return 'clicked'
    })()`)
    const shot = async name => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
    }
    const waitFor = async (description, predicate, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (await predicate()) return
        await sleep(500)
      }
      throw new Error(`timed out waiting for ${description}`)
    }
    const dismissDialogs = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (Number(await visibleCount('[role="dialog"],dialog')) === 0) return
        await evaluate(`(() => {
          const scope = [...document.querySelectorAll('[role="dialog"],dialog')]
            .find(node => node.getClientRects().length > 0)
          if (!scope) return 'none'
          const buttons = [...scope.querySelectorAll('button')]
            .filter(node => node.getClientRects().length > 0)
          const dismiss = buttons.find(node =>
            /^(稍后配置|稍后|继续|知道了|关闭|Later|Continue|Got it|Close|Skip|Not now|×)$/.test(
              (node.textContent || '').trim(),
            ))
          const button = dismiss ?? buttons.at(-1)
          if (!button) return 'missing'
          button.click()
          return 'clicked'
        })()`)
        await sleep(700)
      }
    }
    const openPanel = async () => {
      if (await evaluate("!!document.querySelector('.ch-main')")) return true

      for (const label of sessionLabels) {
        const result = await clickText(label)
        if (result === 'clicked') {
          await sleep(1200)
          break
        }
      }

      for (let attempt = 0; attempt < 4; attempt += 1) {
        // Some shell builds hide plugin panels behind the Plugins button.
        await evaluate(`(() => {
          const nodes = [...document.querySelectorAll('button,[role="button"],a')]
            .filter(node => node.getClientRects().length > 0)
          const toggle = nodes.find(node => /^(插件|Plugins?)$/.test(
            (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim(),
          ))
          if (toggle) toggle.click()
        })()`)
        await sleep(400)

        for (const label of panelLabels) {
          await clickText(label)
          await sleep(1000)
          if (await evaluate("!!document.querySelector('.ch-main')")) return true
        }
      }
      return false
    }
    const openSettings = async () => {
      for (const label of settingsLabels) {
        const result = await clickText(label, { last: true })
        if (result === 'clicked') break
      }
      await waitFor(
        'DSH Settings dialog',
        async () => Number(await visibleCount('[role="dialog"],dialog')) > 0,
      )

      for (const label of panelLabels) {
        await evaluate("window.__chPackagedLabel = " + JSON.stringify(label) + "; 'set'")
        await evaluate(`(() => {
          const wanted = window.__chPackagedLabel
          const nodes = [...document.querySelectorAll('button,a,li,[role],[data-slot]')]
            .filter(node => node.getClientRects().length > 0)
            .filter(node => (node.textContent || '').trim() === wanted)
          if (!nodes.length) return 'missing'
          const target = nodes.at(-1)
          target.click()
          const clickable = target.closest('button,[role="tab"],[role="menuitem"],li,a,[data-slot]')
          if (clickable && clickable !== target) clickable.click()
          return 'clicked'
        })()`)
        await sleep(800)
        if (Number(await visibleCount('.ch-settings-item')) > 0) return true
      }
      return false
    }

    await send('Page.navigate', { url: panelUrl })
    await sleep(8000)
    await dismissDialogs()
    if (!await openPanel()) throw new Error('Computer History panel did not mount from the installed bundle')

    await waitFor(
      'Computer History first-run state',
      async () => Boolean(await evaluate("!!document.querySelector('.ch-first-run')")),
    )
    const firstRunAction = await evaluate(`(() => {
      const button = document.querySelector('.ch-first-run-action button')
      return button ? { present: true, disabled: button.disabled, text: (button.textContent || '').trim() } : { present: false }
    })()`)
    if (!firstRunAction?.present) throw new Error('first-run state has no action')
    if (firstRunAction.disabled) throw new Error(`first-run action is disabled: ${firstRunAction.text ?? ''}`)

    await waitFor(
      'a History API request from the installed panel',
      async () => [...requests].some(requestUrl =>
        /\/api\/computer-history\/(?:recent|timeline|threads)(?:[/?]|$)/.test(requestUrl),
      ),
    )
    await shot('first-run')
    writeFileSync(
      path.join(outDir, 'first-run.txt'),
      String(await evaluate("document.querySelector('.ch-first-run')?.innerText || ''")),
    )

    if (!await openSettings()) throw new Error('Computer History Settings surface did not mount')
    const settingsRows = Number(await visibleCount('.ch-settings-item'))
    if (settingsRows < 8) {
      throw new Error(`installed Settings surface exposed only ${settingsRows} row(s), expected at least 8`)
    }
    await waitFor(
      'Privacy requests from the installed Settings surface',
      async () => {
        const seen = [...requests]
        const policy = seen.some(requestUrl => /\/api\/computer-history\/policy(?:[/?]|$)/.test(requestUrl))
        const retention = seen.some(requestUrl => /\/api\/computer-history\/retention(?:[/?]|$)/.test(requestUrl))
        return policy && retention
      },
    )
    await shot('settings')
    writeFileSync(
      path.join(outDir, 'settings.txt'),
      String(await evaluate("document.querySelector('.ch-settings-list')?.innerText || ''")),
    )

    const cookies = (await send('Network.getAllCookies')).cookies ?? []
    if (cookieOut) {
      mkdirSync(path.dirname(path.resolve(cookieOut)), { recursive: true })
      writeFileSync(path.resolve(cookieOut), netscapeCookieJar(cookies), { mode: 0o600 })
    }

    const observed = [...requests]
      .map(requestUrl => {
        try {
          const parsed = new URL(requestUrl)
          return parsed.pathname + parsed.search
        } catch {
          return requestUrl
        }
      })
      .filter(value => value.includes('/api/computer-history/'))
      .toSorted()
    const evidence = {
      platform: process.platform,
      browser: path.basename(executable),
      panelMounted: true,
      firstRunMounted: true,
      firstRunAction: firstRunAction.text,
      settingsRows,
      historyRequest: observed.find(value => /\/(?:recent|timeline|threads)(?:[/?]|$)/.test(value)),
      privacyRequests: observed.filter(value => /\/(?:policy|retention)(?:[/?]|$)/.test(value)),
    }
    writeFileSync(path.join(outDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
    console.log(
      `packaged client verified on ${process.platform}: panel + first-run + ${settingsRows} Settings rows; `
      + `History/Privacy requests observed`,
    )
  } finally {
    try { socket?.close() } catch { /* browser is already closing */ }
    try { browser.kill() } catch { /* ephemeral CI runner will reap it */ }
    await sleep(500)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* evidence must survive browser cleanup */ }
  }
}

main().catch(error => {
  console.error(`packaged client verification failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
