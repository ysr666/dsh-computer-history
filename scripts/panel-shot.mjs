#!/usr/bin/env node
// Capture and measure the panel from a real browser, in one run.
//
//   node scripts/panel-shot.mjs
//
// Needs a running Host and a Chrome of its own, so the owner's window is never touched:
//
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//     --remote-debugging-port=19222 --user-data-dir=/tmp/dch-ui/chrome-profile \
//     --no-first-run "http://127.0.0.1:19387/"
//
// plus the auth cookie in /tmp/dsh-ch-cookie.txt (the page shows "authentication required"
// without it, and then every measurement below is a measurement of the error page). It exists because writing panel code without
// looking at the panel produced an invisible health line, dim unreadable text and buttons
// squeezed into two-character columns.
//
// The rule learned the hard way: reload first, then measure, then capture - the number and
// the picture must come from the same run, or they describe different builds.
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const PORT = process.env.CDP_PORT ?? '19222'
// Which Host the page under test belongs to. It was hardcoded to the desktop profile's port while the
// debugging port above was already configurable, so the tool could only ever measure one Host.
const TARGET_URL_MATCH = process.env.TARGET_URL_MATCH ?? '19387'
const OUT = process.env.OUT_DIR ?? '/tmp/dch-ui'
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(0) }, 90000)

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find(t => t.type === 'page' && t.url.includes(TARGET_URL_MATCH))
if (!page) { console.log(`no Host page for ${TARGET_URL_MATCH} in the browser`); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
})
await new Promise(r => { ws.addEventListener('open', r) })
await send('Page.enable'); await send('Runtime.enable')
const evaluate = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, expression })).result?.value

// 1. fresh build, fresh page: reload before measuring anything
await send('Page.reload', { ignoreCache: true })
await new Promise(r => setTimeout(r, 9000))
// The first-run gate is dismissed without the owner's input; its button is labelled per locale.
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(e => /继续|稍后配置|Skip|Continue|Later/i.test((e.textContent||'').trim()))
  if (b) b.click()
})()`)
await new Promise(r => setTimeout(r, 1200))

// 2. open the panel and prove it opened
// Found by slot and label, not by the English title: the panel is registered in the sidebar list and its
// accessible name follows the locale, so looking for the text `Computer History` found nothing on a Chinese
// GUI - the tool reported "not found" and captured the conversation view instead.
const opened = await evaluate(`(() => {
  const bySlot = document.querySelector('[data-slot="sidebar.panellist"] button, [data-slot="sidebar.panellist"] [role="button"], [data-slot="sidebar.panellist"] a')
  const byLabel = [...document.querySelectorAll('button,[role="button"],a')].find(e => /Computer History|电脑使用记录/.test(e.getAttribute('aria-label') || e.getAttribute('title') || ''))
  const byText = [...document.querySelectorAll('*')].filter(e => (e.textContent||'').trim() === 'Computer History')
    .map(e => e.closest('button,[role="button"],a,[data-slot]')).filter(Boolean)[0]
  const el = bySlot || byLabel || byText
  if (!el) return 'not found'
  el.click(); return 'clicked'
})()`)
await new Promise(r => setTimeout(r, 3500))
const health = await evaluate(`(() => {
  const p = [...document.querySelectorAll('p')].find(e => (e.getAttribute('role')||'') === 'status')
  return p ? (p.textContent||'').slice(0, 60) : '(no status line)'
})()`)

// 3. geometry: a squeezed button is the tell that a row cannot wrap
const buttons = JSON.parse(String(await evaluate(`(() => {
  const main = document.querySelector('main')
  if (!main) return '[]'
  return JSON.stringify([...main.querySelectorAll('button')].map(b => ({
    label: (b.textContent||'').trim().slice(0, 12), w: Math.round(b.getBoundingClientRect().width),
    h: Math.round(b.getBoundingClientRect().height),
  })))
})()`)))
const squeezed = buttons.filter(b => b.h > 46)

// 4. scroll every scrollable ancestor of the destructive warning, then measure it
const warning = await evaluate(`(() => {
  const p = [...document.querySelectorAll('p')].find(e => (e.textContent||'').includes('不可撤销'))
  if (!p) return JSON.stringify({ found: false })
  let el = p.parentElement, scrolled = 0
  while (el) { if (el.scrollHeight > el.clientHeight + 20) { el.scrollTop = el.scrollHeight; scrolled += 1 } el = el.parentElement }
  const r = p.getBoundingClientRect()
  return JSON.stringify({ found: true, scrolled, top: Math.round(r.top), visible: r.top >= 0 && r.bottom <= window.innerHeight })
})()`)
await new Promise(r => setTimeout(r, 1200))

const shot = await send('Page.captureScreenshot', { format: 'png' })
const bytes = Buffer.from(shot.data, 'base64')
writeFileSync(`${OUT}/panel-verified.png`, bytes)

console.log('opened:', opened)
console.log('health line:', health)
console.log('buttons:', buttons.length, '| squeezed (height > 46px):', squeezed.length, JSON.stringify(squeezed))
console.log('destructive warning:', warning)
console.log('capture:', bytes.length, 'bytes, sha', createHash('sha256').update(bytes).digest('hex').slice(0, 12))
process.exit(0)
