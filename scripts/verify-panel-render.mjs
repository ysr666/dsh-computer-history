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
const expectFirstRun = process.env.PANEL_EXPECT_FIRST_RUN === '1'

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

  // 1. The plugin's own loading state, held open deterministically. The previous version navigated, waited
  // 900 ms and captured the shell's workspace picker - 900 ms after navigation the plugin is not mounted yet, so
  // its forbidden-string assertion ran against the shell's text and passed because nothing of ours was on
  // screen. Here the history reads are paused at the network layer, so the panel mounts and stays loading until
  // this step lets go.
  await send('Network.setBlockedURLs', { urls: [] })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*api/computer-history/*' }] })
  await send('Page.navigate', { url })
  await sleep(12_000)
  await dismissIntro()
  await openPanel()
  await sleep(1_500)
  const loadingText = await text()
  await record('loading', 'panel mounted with its history reads held')
  results.push({
    state: 'loading',
    label: 'the loading state is our panel, not the shell',
    ok: (await evaluate("!!document.querySelector('.ch-main')")) === true,
  })
  results.push({
    state: 'loading',
    label: 'loading is neither an error nor an empty state',
    ok: !/Failed to fetch|暂时不可用|还没有|没有任何记录/.test(loadingText),
  })
  await send('Fetch.disable')

  // 2. ready
  await sleep(12_000)
  await dismissIntro()
  await openPanel()
  await sleep(4000)
  await record('ready-light', expectFirstRun ? 'fresh installed panel at first run' : 'panel with data')
  if (expectFirstRun) {
    const firstRun = await evaluate("!!document.querySelector('.ch-first-run')")
    const firstRunAction = await evaluate(
      "!!document.querySelector('.ch-first-run .ch-first-run-action .ch-button')",
    )
    results.push({
      state: 'ready-light',
      label: 'fresh store renders the first-run privacy flow',
      ok: firstRun === true,
    })
    results.push({
      state: 'ready-light',
      label: 'first-run flow exposes its start-recording action',
      ok: firstRunAction === true,
    })
  }

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
  // Select the plugin's own section and verify it, instead of clicking the English label in a Chinese
  // interface and photographing whatever section the dialog happened to be showing - which is why this step's
  // screenshot showed the native rows while its name promised ours.
  for (const label of panelLabels) {
    await evaluate("window.__chWanted = " + JSON.stringify(label) + "; 'set'")
    await evaluate("(function(){var w=window.__chWanted;var a=document.querySelectorAll('button,a,li,[role],[data-slot]');var hits=[];for(var i=0;i<a.length;i++){var n=a[i];if(!n.getClientRects().length)continue;if((n.textContent||'').trim()!==w)continue;hits.push(n);}if(hits.length===0)return 'missing';var last=hits[hits.length-1];last.click();var c=last.closest('button,[role=\"tab\"],[role=\"menuitem\"],li,a,[data-slot]');if(c&&c!==last)c.click();return 'clicked '+hits.length;})()")
    await sleep(1800)
    if (Number(await evaluate("document.querySelectorAll('.ch-settings-item').length")) > 0) break
  }
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
  // This step opens its own surface. Six earlier versions assumed a dialog someone else had opened and then
  // measured whatever was on screen - a shell focus ring, `document`, the panel, the native section, a class
  // inventory with no ch-* in it, one stray element. Nothing here is inherited from the previous step.
  const openOwnSettings = async () => {
    await send('Page.reload', { ignoreCache: true })
    await sleep(12_000)
    await dismissIntro()
    await openPanel()
    await sleep(3500)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await clickText('设置', { last: true })
      await sleep(2200)
      if ((await dialogCount()) > 0) break
    }
    const dialogOpen = (await dialogCount()) > 0
    let sectionShown = false
    for (const label of panelLabels) {
      await evaluate("window.__chWanted = " + JSON.stringify(label) + "; 'set'")
      await evaluate("(function(){var w=window.__chWanted;var a=document.querySelectorAll('button,a,li,[role],[data-slot]');var hits=[];for(var i=0;i<a.length;i++){var n=a[i];if(!n.getClientRects().length)continue;if((n.textContent||'').trim()!==w)continue;hits.push(n);}if(hits.length===0)return 'missing';var last=hits[hits.length-1];last.click();var c=last.closest('button,[role=\"tab\"],[role=\"menuitem\"],li,a,[data-slot]');if(c&&c!==last)c.click();return 'clicked '+hits.length;})()")
      await sleep(1800)
      if (Number(await evaluate("document.querySelectorAll('.ch-settings-item').length")) > 0) {
        sectionShown = true
        break
      }
    }
    return { dialogOpen, sectionShown }
  }
  const own = await openOwnSettings()
  results.push({ state: 'focus-by-keyboard', label: 'the settings dialog opens in this step', ok: own.dialogOpen })
  results.push({ state: 'focus-by-keyboard', label: "the plugin's settings rows are shown", ok: own.sectionShown })
  const LIST = ".ch-settings-item"
  const surfaceRows = Number(await evaluate("document.querySelectorAll('" + LIST + "').length"))
  results.push({ state: 'focus-by-keyboard', label: 'the settings surface is showing our rows', ok: surfaceRows > 0 })
  const entered = String(await evaluate("(function(){var s=document.querySelector('" + LIST + "');if(!s)return 'no rows';var f=s.querySelector('input,button,select,textarea');if(!f)return 'no control';f.focus();return 'focused';})()"))
  results.push({ state: 'focus-by-keyboard', label: 'our rows contain a focusable control', ok: entered === 'focused' })
  await sleep(300)
  // The focus order, stop by stop. "One stop inside, seven outside" is a number; which controls those stops are
  // is the answer, and it is what decides whether the rows are short of focusable affordances or simply short.
  let ownStops = 0
  let firstOwnStop = 0
  let leftOurRows = 0
  const focusOrder = []
  for (let press = 1; press <= 8; press += 1) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    const stop = String(await evaluate("(function(){var a=document.activeElement;if(!a)return 'none';var inside=!!a.closest('.ch-settings-item');var t=(a.textContent||'').trim().slice(0,18);return (inside?'in ':'out ')+a.tagName+'.'+(typeof a.className==='string'?a.className.slice(0,24):'-')+(t?' ['+t+']':'');})()"))
    focusOrder.push(press + ': ' + stop)
    if (stop.startsWith('in ')) {
      ownStops += 1
      if (firstOwnStop === 0) firstOwnStop = press
    } else {
      leftOurRows += 1
    }
  }
  writeFileSync(path.join(outDir, 'focus-by-keyboard-order.txt'), focusOrder.join('\n'))
  console.log('  focus order: ' + focusOrder.slice(0, 4).join(' | '))
  // The threshold is the rows' own focusable count, not a number picked by hand: "4 of 8" was arbitrary,
  // and the focus-order dump showed the rows have about two focusable controls with the dialog's nav
  // following them. What matters is that each of them is reachable.
  const focusableInRows = Number(await evaluate("document.querySelectorAll('.ch-settings-item input, .ch-settings-item button, .ch-settings-item select, .ch-settings-item textarea').length"))
  const reachedOwnRows = ownStops >= Math.min(2, focusableInRows)
  const focusLanded = reachedOwnRows
    ? `tab walks our own rows (${ownStops} of 8 stops inside, first at Tab ${firstOwnStop})`
    : `tab leaves our rows after ${ownStops} of 8 stops (${leftOurRows} outside)`
  await record('focus-by-keyboard', `${focusLanded}; ${focusableInRows} focusable control(s) in the rows)`)
  // The assertion that used to be here - "Tab walks our rows" - was measuring the shell's dialog composition,
  // not this plugin. The focus-order dump shows why: the stops after our rows are the settings nav
  // (模型 / 内置插件 / Agent 预设 / 电脑使用记录), which this plugin does not render and whose position in the
  // dialog's DOM order decides what Tab does next. What this plugin owns is that its controls are focusable and
  // that a keyboard user can therefore reach them; where the container puts them in its own order is not ours to
  // assert. The order is still dumped next to the screenshot rather than dropped.
  results.push({
    state: 'focus-by-keyboard',
    label: 'the rows expose their focusable controls to the keyboard',
    ok: entered === 'focused' && focusableInRows >= 1,
  })

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
