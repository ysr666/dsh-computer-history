import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

/** No DSH patch, Chrome debugger port, or production plugin is ever created. */
export function validateDevBrowserOptions({ url, chromeBin, puppeteerEntry, headless = false }) {
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
  return { url: parsed.href, chromeBin, puppeteerEntry, headless: headless === true }
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
    let closed = false
    let tail = Promise.resolve()
    return {
      reload() {
        if (closed) return Promise.reject(new Error('Dev browser is closed'))
        const job = tail.then(async () => {
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
