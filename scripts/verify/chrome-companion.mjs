// Phase 2.1 privacy matrix, on real Chrome (ADR 0007).
//
//   node scripts/verify/chrome-companion.mjs \
//     --token <pairing token> --db <history.sqlite> \
//     --api http://127.0.0.1:19387/api/computer-history \
//     --cookie /tmp/dsh-ch-cookie.txt --extension dist/extension
//
// It launches a throwaway Chrome profile with the extension loaded, points it at
// a local site, and checks what reached the store for each cell:
//
//   allowed origin   → rows appear, resource is the normalised URL
//   query + fragment → never stored
//   denied origin    → no rows
//   incognito        → no rows (the extension cannot even see the window)
//   extension off    → no rows
//   rotated token    → no rows
//
// Everything happens on loopback; the profile is removed afterwards.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const intakePort = Number(arg('port', '19388'))
const token = arg('token')
const dbPath = arg('db')
const apiBase = arg('api', 'http://127.0.0.1:19387/api/computer-history')
const cookieFile = arg('cookie', '/tmp/dsh-ch-cookie.txt')
const extensionDir = path.resolve(arg('extension', 'dist/extension'))

if (!token || !dbPath) {
  console.error('--token and --db are required')
  process.exit(2)
}

const cookie = (() => {
  try {
    let raw = readFileSync(cookieFile, 'utf8').trim()
    if (raw.toLowerCase().startsWith('cookie:')) {
      raw = raw.slice('cookie:'.length).trim()
    }
    // The helper file stores "cookie=<value>", which is the pair, not the
    // header name: sending it back unprefixed would authenticate as a cookie
    // literally named "cookie".
    if (/^cookie=/i.test(raw)) raw = raw.slice('cookie='.length)
    return raw
  } catch {
    return ''
  }
})()

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function api(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  })
  return response
}

function rowCount(originLike) {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM observations o
      LEFT JOIN resources r ON r.id = o.resource_id
      WHERE o.source_provider = 'companion'
        AND (r.canonical_uri IS NULL OR r.canonical_uri LIKE ?)
    `).get(`%${originLike}%`)
    return Number(row.count)
  } finally {
    db.close()
  }
}

function storedUrls() {
  const db = new DatabaseSync(dbPath)
  try {
    return db.prepare(`
      SELECT r.canonical_uri AS uri
      FROM observations o
      JOIN resources r ON r.id = o.resource_id
      WHERE o.source_provider = 'companion'
      ORDER BY o.observed_at_ms
    `).all().map(row => String(row.uri))
  } finally {
    db.close()
  }
}

// A local site so the matrix never depends on the network.
const site = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(`<!doctype html><title>${request.url} page</title><h1>${request.url}</h1>`)
})
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve))
const sitePort = site.address().port
const siteOrigin = `http://127.0.0.1:${sitePort}`

function launchChrome({ withExtension, profile, debugPort }) {
  const args = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-background-networking',
    'about:blank',
  ]
  if (withExtension) {
    // Chrome 154 ignores --load-extension (it is refused unless unsafe
    // extension debugging is on, and even then the command line is not the
    // supported path any more), so the extension is loaded over CDP below.
    args.push('--enable-unsafe-extension-debugging')
  }
  const child = spawn(CHROME, args, { stdio: 'ignore', detached: false })
  return child
}

async function cdpHttp(debugPort, pathname, method = 'GET') {
  const response = await fetch(`http://127.0.0.1:${debugPort}${pathname}`, {
    method,
  })
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function waitForDebugger(debugPort) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const version = await cdpHttp(debugPort, '/json/version')
      if (version.webSocketDebuggerUrl) return version
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}

/** Minimal CDP session over the global WebSocket (Node 22+). */
class Session {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve())
      this.socket.addEventListener('error', event => reject(event.error ?? new Error('ws error')))
    })
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      const waiter = this.pending.get(message.id)
      if (waiter) {
        this.pending.delete(message.id)
        waiter(message)
      }
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId
    this.nextId += 1
    const promise = new Promise(resolve => this.pending.set(id, resolve))
    this.socket.send(JSON.stringify({ id, method, params }))
    return promise
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    return result.result?.result?.value
  }

  close() {
    try {
      this.socket.close()
    } catch {
      // already gone
    }
  }
}

const findings = []
function record(cell, expected, actual, detail) {
  const pass = actual === expected
  findings.push({ cell, expected, actual, detail, pass })
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${cell}: expected ${expected}, got ${actual}`
    + (detail ? ` — ${detail}` : ''),
  )
}

const profile = mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-chrome-'))
const debugPort = 9333
let chrome

try {
  // Baseline: whatever is already stored for this site.
  const siteLike = siteOrigin
  const before = rowCount(siteLike)
  console.log(`baseline companion rows for ${siteOrigin}: ${before}`)

  // The policy: allow the companion app, allow the site, deny one path.
  const now = Date.now()
  const policy = {
    mode: 'include-only',
    rules: [
      {
        id: 'app:companion.browser',
        dimension: 'app',
        action: 'allow',
        matcher: 'exact',
        pattern: 'companion.browser',
        builtIn: false,
        createdAtMs: now,
        updatedAtMs: now,
      },
      {
        id: 'resource:denied',
        dimension: 'resource',
        action: 'deny',
        matcher: 'prefix',
        pattern: `${siteOrigin}/denied`,
        builtIn: false,
        createdAtMs: now,
        updatedAtMs: now,
      },
    ],
  }
  const policyResponse = await api('/policy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(policy),
  })
  console.log(`policy update: HTTP ${policyResponse.status}`)

  chrome = launchChrome({ withExtension: true, profile, debugPort })
  const version = await waitForDebugger(debugPort)
  const browser = new Session(version.webSocketDebuggerUrl)

  const loaded = await browser.send('Extensions.loadUnpacked', {
    path: extensionDir,
  })
  if (loaded.error || !loaded.result?.id) {
    throw new Error(`loading the extension failed: ${JSON.stringify(loaded)}`)
  }
  const extensionId = loaded.result.id
  console.log(`extension id: ${extensionId} (loaded over CDP)`)

  // Confirm the worker target exists, so a silently refused load cannot pass
  // for a working pairing later.
  let workerSeen = false
  for (let attempt = 0; attempt < 20 && !workerSeen; attempt += 1) {
    const targets = await cdpHttp(debugPort, '/json/list')
    workerSeen = (Array.isArray(targets) ? targets : []).some(
      target => String(target.url)
        === `chrome-extension://${extensionId}/service-worker.js`,
    )
    if (!workerSeen) await sleep(250)
  }
  if (!workerSeen) throw new Error('the extension loaded but its worker never started')

  // Wake the extension first: an MV3 service worker sleeps, and a sleeping
  // worker has no target to attach to. Opening the options page starts the
  // extension process and gives a context where chrome.storage is available.
  await cdpHttp(
    debugPort,
    `/json/new?chrome-extension://${extensionId}/options.html`,
    'PUT',
  )
  await sleep(1500)
  const targets = await cdpHttp(debugPort, '/json/list')
  // Match this extension's id: several built-in component extensions expose
  // service workers and pages of their own, and they have no chrome.storage.
  const own = target =>
    String(target.url).startsWith(`chrome-extension://${extensionId}/`)
  const workerTarget = targets.find(
    target => target.type === 'service_worker' && own(target),
  ) ?? targets.find(own)
  if (!workerTarget) throw new Error('the extension worker target is missing')
  const worker = new Session(workerTarget.webSocketDebuggerUrl)
  const expression = `
    (async () => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return 'NO-STORAGE:' + typeof chrome
      }
      await chrome.storage.local.set({
        companionPort: ${intakePort},
        companionToken: ${JSON.stringify(token)},
      })
      return JSON.stringify(
        await chrome.storage.local.get(['companionPort', 'companionToken']),
      )
    })()
  `
  const paired = await worker.evaluate(expression)
  if (paired === undefined) {
    const raw = await worker.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    throw new Error(`pairing failed: ${JSON.stringify(raw)}`)
  }
  console.log(`pairing written into the extension: ${paired}`)
  worker.close()

  async function visit(url) {
    await cdpHttp(debugPort, `/json/new?${encodeURIComponent(url)}`, 'PUT')
    await sleep(2000)
  }

  // Cell 1 + 3: an allowed origin, with a query string and a fragment.
  const allowedUrl = `${siteOrigin}/allowed/page?token=secret#part-3`
  await visit(allowedUrl)
  const afterAllowed = rowCount(siteLike)
  record(
    'allowed origin stores rows',
    true,
    afterAllowed > before,
    `${before} → ${afterAllowed}`,
  )
  if (afterAllowed === before) {
    console.error(
      'the control cell failed: every other cell would pass vacuously, so the '
      + 'matrix is reported as failing rather than as mostly green',
    )
  }
  const urls = storedUrls().filter(uri => uri.startsWith(siteOrigin))
  record(
    'query string and fragment never stored',
    true,
    urls.length > 0 && urls.every(uri => !uri.includes('?') && !uri.includes('#')),
    urls.join(' '),
  )
  record(
    'stored path is the normalised one',
    true,
    urls.includes(`${siteOrigin}/allowed/page`),
    urls.join(' '),
  )

  // Cell 2: a denied origin.
  const beforeDenied = rowCount(siteLike)
  await visit(`${siteOrigin}/denied/page`)
  record(
    'denied origin stores nothing',
    true,
    rowCount(siteLike) === beforeDenied,
    `rows stayed ${beforeDenied}`,
  )

  // Cell 4: incognito. The extension is not_allowed in incognito, so the
  // context is invisible to it; the browser context is created through CDP.
  const beforeIncognito = rowCount(siteLike)
  const context = await browser.send('Target.createBrowserContext', {
    disposeOnDetach: false,
  })
  const contextId = context.result?.browserContextId
  await browser.send('Target.createTarget', {
    url: `${siteOrigin}/allowed/incognito`,
    browserContextId: contextId,
  })
  await sleep(2500)
  record(
    'incognito stores nothing',
    true,
    rowCount(siteLike) === beforeIncognito,
    `rows stayed ${beforeIncognito}`,
  )
  await browser.send('Target.disposeBrowserContext', { browserContextId: contextId })

  // Cell 6: a rotated token leaves the extension unpaired.
  const beforeRotation = rowCount(siteLike)
  const rotated = await api('/pairing/rotate', { method: 'POST' })
  const rotatedText = await rotated.text()
  let rotatedBody = {}
  try {
    rotatedBody = JSON.parse(rotatedText)
  } catch {
    throw new Error(`pairing rotation failed: HTTP ${rotated.status} ${rotatedText}`)
  }
  console.log(`rotated pairing: HTTP ${rotated.status}, token ${String(rotatedBody.token).length} chars`)
  await visit(`${siteOrigin}/allowed/after-rotation`)
  record(
    'rotated token stores nothing',
    true,
    rowCount(siteLike) === beforeRotation,
    `rows stayed ${beforeRotation}`,
  )

  browser.close()
  chrome.kill('SIGTERM')
  await sleep(2000)

  // Cell 5: the extension is not loaded at all.
  const beforeOff = rowCount(siteLike)
  const debugPortOff = 9334
  chrome = launchChrome({
    withExtension: false,
    profile: mkdtempSync(path.join(os.tmpdir(), 'dsh-ch-chrome-off-')),
    debugPort: debugPortOff,
  })
  await waitForDebugger(debugPortOff)
  await cdpHttp(
    debugPortOff,
    `/json/new?${encodeURIComponent(`${siteOrigin}/allowed/no-extension`)}`,
    'PUT',
  )
  await sleep(2500)
  record(
    'extension disabled stores nothing',
    true,
    rowCount(siteLike) === beforeOff,
    `rows stayed ${beforeOff}`,
  )
} finally {
  try {
    chrome?.kill('SIGTERM')
  } catch {
    // already gone
  }
  await sleep(1500)
  site.close()
  rmSync(profile, { recursive: true, force: true })
}

const failed = findings.filter(finding => !finding.pass)
console.log(`\nmatrix: ${findings.length - failed.length}/${findings.length} cells pass`)
console.log(JSON.stringify(findings, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
