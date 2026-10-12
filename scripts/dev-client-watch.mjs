import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDevBrowser, validateDevBrowserOptions } from './dev-client-browser.mjs'

/**
 * Serialize rebuilds: a change during an active build gets exactly one later
 * build, rather than letting clean-build remove another build's output.
 * This queue is independent of fs.watch so it can be regression-tested.
 */
export function createRebuildScheduler({ run, onError = console.error, debounceMs = 180 }) {
  if (typeof run !== 'function' || !Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new TypeError('run and a nonnegative debounceMs are required')
  }
  let timer
  let active = false
  let dirty = false
  let closed = false

  const drain = async () => {
    if (closed || active || !dirty) return
    dirty = false
    active = true
    try {
      await run()
    } catch (error) {
      try { onError(error) } catch { /* diagnostic callback cannot break the watcher */ }
    } finally {
      active = false
      if (!closed && dirty && timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined
          void drain()
        }, 0)
      }
    }
  }

  return {
    request() {
      if (closed) return
      dirty = true
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void drain()
      }, debounceMs)
    },
    close() {
      closed = true
      dirty = false
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function buildOnce(getChild) {
  return new Promise((resolveBuild, rejectBuild) => {
    const isWindows = process.platform === 'win32'
    const command = isWindows ? 'cmd.exe' : 'pnpm'
    const args = isWindows ? ['/d', '/s', '/c', 'pnpm', 'build'] : ['build']
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
    getChild(child)
    child.once('error', rejectBuild)
    child.once('close', (code, signal) => {
      getChild(undefined)
      if (code === 0) resolveBuild()
      else rejectBuild(new Error(`Build exited ${signal ?? code}`))
    })
  })
}

function main() {
  const watches = []
  let child
  let exiting = false
  let sequence = 0
  let browser
  const useBrowser = !!process.env.DCH_DEV_BROWSER_URL
  const browserOptions = useBrowser ? validateDevBrowserOptions({
    url: process.env.DCH_DEV_BROWSER_URL,
    chromeBin: process.env.DCH_DEV_CHROME_BIN,
    puppeteerEntry: process.env.DCH_DEV_PUPPETEER_ENTRY,
    headless: process.env.DCH_DEV_HEADLESS === '1',
    reloadMode: process.env.DCH_DEV_RELOAD_MODE || 'page',
  }) : null
  const scheduler = createRebuildScheduler({
    async run() {
      const n = ++sequence
      const begin = performance.now()
      console.log(`[dev:watch] build #${n} started`)
      await buildOnce(value => { child = value })
      // Browser bundle must be complete before any navigation may observe it.
      const { readFileSync, existsSync } = await import('node:fs')
      const clientFile = join(root, 'lib/client.js')
      if (!existsSync(join(root, 'lib/client.d.ts')) ||
          !readFileSync(clientFile, 'utf8').includes('window.__ModuleLoader__.load')) {
        throw new Error('DSH client factory/declarations missing after build')
      }
      console.log(`[dev:watch] build #${n} ready in ${Math.round(performance.now() - begin)}ms`)
      if (exiting) return
      if (!browserOptions) {
        console.log('[dev:watch] No browser configured; DSH client reload is manual.')
      } else {
        try {
          if (!browser) {
            const launched = await openDevBrowser(browserOptions)
            if (exiting) {
              await launched.close()
              return
            }
            browser = launched
            console.log(browserOptions.reloadMode === 'native-hmr'
              ? '[dev:watch] Native DSH HMR active; changes swap Client without page navigation.'
              : '[dev:watch] Isolated browser opened (full-page reload mode).')
          } else {
            await browser.reload()
            console.log(browserOptions.reloadMode === 'native-hmr'
              ? '[dev:watch] Build ready; DSH native HMR watches the emitted Client artifact.'
              : '[dev:watch] Browser page reloaded after successful build.')
          }
        } catch (error) {
          console.error('[dev:watch] browser refresh failed (build succeeded):', error)
          if (browser) {
            const stale = browser
            browser = undefined
            await stale.close().catch(() => {})
          }
        }
      }
    },
    onError(error) {
      console.error('[dev:watch] build failed (watching for next change):', error)
    },
  })

  const observe = (dir, recursive, relevant) => {
    watches.push(watch(join(root, dir), { recursive }, (_event, filename) => {
      if (!filename || relevant(String(filename))) scheduler.request()
    }))
  }
  // Only source, builder and compiler config; never watch dist (our own output).
  try {
    // Client directly imports shared utilities; both trees are hot-build inputs.
    observe('src/client', true, () => true)
    observe('src/shared', true, () => true)
    observe('scripts', false, filename => /^(?:write-build-info)\.mjs$/.test(filename))
    observe('.', false, filename => /^(?:package\.json|tsconfig\.json|tsdown\.config\.ts)$/.test(filename))
  } catch (error) {
    for (const watcher of watches) watcher.close()
    throw error
  }
  const stop = () => {
    if (exiting) return
    exiting = true
    scheduler.close()
    for (const watcher of watches) watcher.close()
    child?.kill('SIGTERM')
    void browser?.close().catch(error => console.error('[dev:watch] browser close failed:', error))
    process.exitCode = 0
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  scheduler.request() // Initial build, including the browser factory contract check.
  console.log('[dev:watch] Watching src/client/, src/shared/, build info and compiler config. Ctrl+C to stop.')
  if (browserOptions) console.log(`[dev:watch] Browser mode: ${browserOptions.reloadMode}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
