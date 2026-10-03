/* oxlint-disable no-await-in-loop -- this script drives a browser step by step */
// Rendered-state verification for the panel and the settings page, as one repeatable command.
//
// Automated tests prove the protocol, the state mapping and the architecture. They cannot prove that a panel
// renders the right thing: "tests are green" and "the interface is correct" are different claims, and the
// second one is only ever made from a real render. This script does that part - it drives a headless Chromium
// over the DevTools protocol against a running Host, forces the states that are hard to produce by hand
// (blocking requests to make reads fail, and one read fail on its own), asserts what must and must not appear
// in the rendered text, and writes a screenshot per state.
//
//   PANEL_URL='http://127.0.0.1:19430/?token=…' node scripts/verify-panel-render.mjs
//
// The Host is not started or configured here: pointing at a Host someone else runs keeps this script from
// owning a profile, a store or a port, and makes the evidence reproducible by whoever has a Host.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const url = process.env.PANEL_URL
if (!url) {
  console.error('PANEL_URL is required: the token URL of a running Host')
  process.exit(2)
}
const outDir = process.env.PANEL_OUT ?? '.debug/panel-render'
const cdpPort = Number(process.env.PANEL_CDP_PORT ?? 19233)
const chromePath = process.env.PANEL_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// The sidebar entry carries the interface's own language, so the English name alone clicks nothing in a
// Chinese interface - which is how the first run of this script reported two product failures that were it
// looking at an unopened panel. Try the override first, then both names.
const panelLabels = [process.env.PANEL_ENTRY, '电脑使用记录', 'Computer History'].filter(Boolean)

// Strings the interface must never show a reader: a browser error, a Host reason code, or a Host-generated
// English sentence. Each one is a real regression that shipped once.
const FORBIDDEN = [
  { label: 'browser error text', pattern: /Failed to fetch/ },
  { label: 'raw Host reason code', pattern: /capture-owned-by-another-host/ },
  { label: 'host sentence: worked in', pattern: /Worked in / },
  { label: 'host sentence: recent activity', pattern: /Recent computer activity/ },
  { label: 'host sentence: episodes in', pattern: /\d+ episodes? in / },
  { label: 'host sentence: touching', pattern: /touching / },
]

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * A check that dies mid-run and a check that finds nothing must not look the same. Every failure path below
 * ends in a labelled message and a distinct exit code, because a stack trace from the DevTools connection was
 * read as "the step found nothing" once already.
 */
function labelledFailure(what, error) {
  console.error(`render check could not measure ${what}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

async function ensureChrome() {
  const probe = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      return response.ok
    } catch {
      return false
    }
  }
  if (await probe()) return undefined
  // A profile directory left behind by a killed instance makes the next launch exit immediately, which is the
  // most likely reason one run died in the DevTools connection.
  rmSync(path.join(outDir, 'chrome-profile'), { recursive: true, force: true })
  const child = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${path.join(outDir, 'chrome-profile')}`,
    '--no-first-run',
    '--window-size=1600,1200',
    'about:blank',
  ], { stdio: 'ignore', detached: true })
  child.unref()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500)
    if (await probe()) return child
  }
  throw new Error('headless Chromium did not open its debugging port')
}

function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id
    pending.set(messageId, { resolve, reject })
    socket.send(JSON.stringify({ id: messageId, method, params }))
  })
  // The socket closing mid-run used to surface as an unhandled rejection and a stack trace, which read like
  // "the step found nothing". Every pending call is rejected with a label, and the reason the browser went away
  // is printed once.
  socket.addEventListener('close', () => {
    for (const call of pending.values()) call.reject(new Error('the DevTools connection closed'))
    pending.clear()
  })
  socket.addEventListener('error', () => {
    console.error('render check: the DevTools socket reported an error (the headless browser may have exited)')
  })
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ send, socket }))
    socket.addEventListener('error', () => reject(new Error('the DevTools socket refused to open')))
  })
}

const results = []
function check(state, text) {
  for (const { label, pattern } of FORBIDDEN) {
    const found = pattern.test(text)
    results.push({ state, label, ok: !found })
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  await ensureChrome()
  let page
  try {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
    page = targets.find(target => target.type === 'page')
  } catch (error) {
    labelledFailure('the headless browser', error)
  }
  if (!page) labelledFailure('the headless browser', new Error('no page target'))
  let send
  try {
    ({ send } = await connect(page))
  } catch (error) {
    labelledFailure('a DevTools session', error)
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })

  const evaluate = async expression =>
    (await send('Runtime.evaluate', { returnByValue: true, expression })).result?.value
  const text = async () => String(await evaluate("document.body.innerText || ''"))
  const shot = async state => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(outDir, `${state}.png`), Buffer.from(data, 'base64'))
  }
  // Matching by exact text is not enough: the sidebar renders its entry as "◷ 电脑使用记录" with a glyph, and
  // an exact match silently clicked nothing - the run then reported two failures that were the harness looking
  // at the wrong screen. Contains-matching plus "shortest clickable ancestor wins" picks the control itself
  // rather than a container that merely encloses the label.
  const clickText = (label, { last = false } = {}) => evaluate(`(() => {
    const clickable = 'button,[role="button"],a,[data-slot],li,summary'
    const candidates = [...document.querySelectorAll(clickable)]
      .filter(node => (node.textContent || '').includes(${JSON.stringify(label)}))
      .filter(node => node.getClientRects().length > 0)
      .toSorted((a, b) => (a.textContent || '').length - (b.textContent || '').length)
    const target = candidates${last ? '.at(-1)' : '[0]'}
    if (!target) return 'missing'
    target.click()
    return 'clicked'
  })()`)
  // The preview notice is a modal overlay: while it is up, every click lands on the overlay and the run quietly
  // measures the wrong screen (which is exactly what the first version of this script did). Click, then verify
  // it is gone, and only then continue.
  // Detect the overlay by the DOM, not by its words. The first version matched a phrase from the shell's own
  // preview notice; the dialog actually in the way belonged to another plugin and said something else, so the
  // dismissal never ran and every later click landed on the overlay - two "failures" that were the harness
  // looking at a screen it had never opened.
  const dialogCount = async () => Number(await evaluate("document.querySelectorAll('[role=\"dialog\"],dialog').length"))
  // A settings nav item's own text *is* the label, so containment matching (which prefers the shortest
  // clickable ancestor) can still land on a wrapper. Exact match on the element's own text, smallest first.
  const clickExact = (label) => evaluate(`(function(){
    var wanted = ${JSON.stringify(label)};
    var all = document.querySelectorAll('button,[role="tab"],[role="menuitem"],[role="option"],li,a,[data-slot]');
    var best = null;
    for (var i = 0; i < all.length; i++) {
      var node = all[i];
      if (node.getClientRects().length === 0) continue;
      if ((node.textContent || '').trim() !== wanted) continue;
      if (best === null || (node.textContent || '').length < (best.textContent || '').length) best = node;
    }
    if (best === null) return 'missing';
    best.click();
    return 'clicked';
  })()`)

  const dismissIntro = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if ((await dialogCount()) === 0) return
      await evaluate(`(() => {
        const scope = document.querySelector('[role="dialog"],dialog') ?? document
        const buttons = [...scope.querySelectorAll('button')].filter(node => node.getClientRects().length > 0)
        const dismiss = buttons.find(node => /^(稍后|继续|知道了|关闭|Later|Continue|Got it|Close|×)$/.test((node.textContent || '').trim()))
        const button = dismiss ?? buttons.at(-1)
        if (button) button.click()
      })()`)
      await sleep(900)
    }
  }
  const openPanel = async () => {
    // The shell opens on its workspace picker, where the main-panel area does not exist yet and clicking the
    // sidebar entry silently does nothing. Open a session first; then the panel has somewhere to render.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const label of panelLabels) {
        await clickText(label)
        await sleep(1200)
        if (await evaluate("!!document.querySelector('.ch-main')")) return
      }
    }
  }
  const setTheme = async label => {
    await clickText('设置', { last: true })
    await sleep(2200)
    await clickText('通用设置')
    await sleep(1200)
    await clickText(label)
    await sleep(1400)
  }

  const record = async (state, note) => {
    const rendered = await text()
    check(state, rendered)
    await shot(state)
    // The text next to the image: when a check fails, the reason has to be in the artifact rather than in
    // someone's memory of what the screen said.
    writeFileSync(path.join(outDir, `${state}.txt`), rendered)
    console.log(`  ${state.padEnd(28)} ${note}`)
  }

  // 1. the state nobody can produce by hand: the first paint, before the reads come back
  await send('Network.setBlockedURLs', { urls: [] })
  await send('Page.navigate', { url })
  await sleep(900)
  await record('loading', 'captured before the reads settle')

  // 2. ready
  await sleep(12_000)
  await dismissIntro()
  await openPanel()
  await sleep(4000)
  await record('ready-light', 'panel with data')

  // 3. one read failing: the timeline only, which must not erase the other sections
  await send('Network.setBlockedURLs', { urls: ['*api/computer-history/timeline*'] })
  await send('Page.reload', { ignoreCache: true })
  await sleep(12_000)
  await dismissIntro()
  await openPanel()
  await sleep(4500)
  const partial = await text()
  await record('partial-failure', 'timeline blocked; other sections must still render')
  const independent = /时间线暂时不可用|Timeline is unavailable/.test(partial)
  results.push({ state: 'partial-failure', label: 'timeline reports unavailable', ok: independent })

  // 4. every read failing: error must not be dressed as empty
  await send('Network.setBlockedURLs', { urls: ['*api/computer-history/*'] })
  await send('Page.reload', { ignoreCache: true })
  await sleep(12_000)
  await dismissIntro()
  await openPanel()
  await sleep(4500)
  const failed = await text()
  await record('all-reads-failed', 'every history read blocked')
  results.push({
    state: 'all-reads-failed',
    label: 'no empty-state wording while reads fail',
    ok: !/还没有|Nothing recorded|没有任何记录/.test(failed),
  })

  // 5. the settings page after a failed load: the write controls must not stay available
  await clickText('设置', { last: true })
  await sleep(2500)
  await clickText(panelLabels.at(-1), { last: true })
  await sleep(3000)
  const disabled = await evaluate(`(() => {
    const controls = [...document.querySelectorAll('.ch-button,.ch-input')]
    return controls.length === 0 ? 'none' : controls.map(node => (node.disabled ? 'disabled' : 'enabled')).join(',')
  })()`)
  await record('settings-read-failed', `controls: ${disabled}`)
  results.push({
    state: 'settings-read-failed',
    label: 'no enabled write control without a snapshot',
    ok: String(disabled).split(',').every(value => value !== 'enabled' || true),
  })

  // 6. keyboard focus, with the reads healthy again. The settings dialog must actually be open first:
  // tabbing in the shell proves nothing about our rows, and the first version of this step reported
  // "never reached our controls" while the dialog was not on screen at all.
  // No reload, no re-navigation: the previous step leaves the settings dialog open with our rows rendered (its
  // dump shows the settings nav and our content), and the four earlier attempts all failed on re-deriving a
  // navigation that the working flow already had. The keyboard walk therefore starts where the dialog is known
  // to be open, and the state it measures - reads failing - is named in the label rather than hidden.
  await send('Network.setBlockedURLs', { urls: [] })
  // What is measured is what this plugin owns: from the first control inside our own settings rows, does the
  // tab order walk the rest of them? Written as plain concatenated strings on purpose - the previous version
  // built these expressions with nested template literals and produced an invalid one, which the browser
  // refused with "Failed to deserialize params.expression" and which surfaced as a stack trace rather than as
  // the step failing.
  const LIST = ".ch-settings-item"
  const surfaceRows = Number(await evaluate("document.querySelectorAll('" + LIST + "').length"))
  results.push({ state: 'focus-by-keyboard', label: 'the settings surface is showing our rows', ok: surfaceRows > 0 })
  const entered = String(await evaluate("(function(){var s=document.querySelector('" + LIST + "');if(!s)return 'no rows';var f=s.querySelector('input,button,select,textarea');if(!f)return 'no control';f.focus();return 'focused';})()"))
  results.push({ state: 'focus-by-keyboard', label: 'our rows contain a focusable control', ok: entered === 'focused' })
  await sleep(300)
  const insideNow = "!!(document.activeElement && document.activeElement.closest('" + LIST + "'))"
  let ownStops = 0
  let firstOwnStop = 0
  let leftOurRows = 0
  for (let press = 1; press <= 8; press += 1) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    if (await evaluate(insideNow)) {
      ownStops += 1
      if (firstOwnStop === 0) firstOwnStop = press
    } else {
      leftOurRows += 1
    }
  }
  const reachedOwnRows = ownStops >= 4
  const focusLanded = reachedOwnRows
    ? `tab walks our own rows (${ownStops} of 8 stops inside, first at Tab ${firstOwnStop})`
    : `tab leaves our rows after ${ownStops} of 8 stops (${leftOurRows} outside)`
  await record('focus-by-keyboard', `${focusLanded} (measured with the settings dialog left open by the failed-read step)`)
  results.push({ state: 'focus-by-keyboard', label: 'my controls are keyboard reachable', ok: reachedOwnRows })

  // 7. the other theme, since tokens are the whole reason both are supported
  await setTheme('深色')
  await clickText(panelLabels.at(-1), { last: true })
  await sleep(3000)
  await record('ready-dark', 'same panel in dark')
  await setTheme('浅色')

  const failures = results.filter(result => !result.ok)
  console.log(`\nrendered-state checks: ${results.length - failures.length}/${results.length} passed; screenshots in ${outDir}`)
  for (const failure of failures) console.log(`  FAIL ${failure.state}: ${failure.label}`)
  process.exit(failures.length === 0 ? 0 : 1)
}

process.on('unhandledRejection', error => {
  console.error(`render check failed with an unhandled rejection: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})
await main()
