import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

/** No DSH patch, Chrome debugger port, or production plugin is ever created. */
export function validateDevBrowserOptions({ url, chromeBin, puppeteerEntry, headless = false, reloadMode = 'page' }) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('Dev browser requires a valid local DSH URL') }
  if (parsed.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      parsed.username || parsed.password) {
    throw new Error('Dev browser requires an unauthenticated-in-authority HTTP loopback URL')
  }
  if (typeof chromeBin !== 'string' || !isAbsolute(chromeBin) ||
      typeof puppeteerEntry !== 'string' || !isAbsolute(puppeteerEntry)) {
    throw new Error('Dev browser requires absolute Chrome and external puppeteer-core paths')
  }
  if (!['page', 'native-hmr'].includes(reloadMode)) throw new Error('Unsupported development reload mode')
  return { url: parsed.href, chromeBin, puppeteerEntry, headless: headless === true, reloadMode }
}

/**
 * Launch an isolated development Chrome over CDP stdio pipe (NOT a remote
 * debugging TCP socket). Its authenticated DSH profile is ephemeral and
 * destroyed by Chromium on close. The tool never prints the supplied URL.
 */
export async function openDevBrowser(options, { loadPuppeteer } = {}) {
  const config = validateDevBrowserOptions(options)
  const imported = loadPuppeteer
    ? await loadPuppeteer()
    : await import(pathToFileURL(config.puppeteerEntry).href)
  const puppeteer = imported.default ?? imported
  if (typeof puppeteer.launch !== 'function') throw new TypeError('puppeteer-core launch() is unavailable')
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: config.chromeBin,
      headless: config.headless,
      pipe: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
    })
    const page = await browser.newPage()
    const initial = await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    if (initial && initial.status() >= 400) {
      throw new Error(`Dev browser initial page returned HTTP ${initial.status()}`)
    }
    if (config.reloadMode === 'native-hmr') {
      // Upstream DSH Web mounts @deepseek-ai/dsh-client-hmr and broadcasts
      // rebuilts on /plugins/events. Do not silently treat absent SSE as HMR.
      const ready = await page.evaluate(async () => {
        if (!globalThis.__DSH_BOOT__?.entries?.some(row => row.id === '@deepseek-ai/dsh-client-hmr')) return false
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 4_000)
        try {
          const response = await fetch('/plugins/events', { signal: controller.signal, cache: 'no-store' })
          return response.ok && response.headers.get('content-type')?.includes('text/event-stream') === true
        } catch {
          return false
        } finally {
          clearTimeout(timer)
          controller.abort()
        }
      })
      if (!ready) throw new Error('Native DSH HMR is unavailable on this isolated Web Host; use page reload mode')
    }
    let closed = false
    let tail = Promise.resolve()
    return {
      reload() {
        if (closed) return Promise.reject(new Error('Dev browser is closed'))
        const job = tail.then(async () => {
          if (config.reloadMode === 'native-hmr') return // DSH SSE owns module replacement.
          if (closed || page.isClosed()) throw new Error('Dev browser page is closed')
          const response = await page.reload({waitUntil: 'domcontentloaded', timeout: 15_000})
          if (response && response.status() >= 400) {
            throw new Error(`Dev browser reload returned HTTP ${response.status()}`)
          }
        })
        tail = job.catch(() => {})
        return job
      },
      async close() {
        if (closed) return
        closed = true
        await tail
        await browser.close()
      },
    }
  } catch (error) {
    await browser?.close().catch(() => {})
    throw error
  }
}
