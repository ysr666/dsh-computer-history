#!/usr/bin/env node
// Capture and measure the panel from a real browser, in one run.
//
//   node scripts/panel-shot.mjs
//
// Needs a running Host and a Chrome started with --remote-debugging-port=19222, plus the
// auth cookie in /tmp/dsh-ch-cookie.txt. It exists because writing panel code without
// looking at the panel produced an invisible health line, dim unreadable text and buttons
// squeezed into two-character columns.
//
// The rule learned the hard way: reload first, then measure, then capture - the number and
// the picture must come from the same run, or they describe different builds.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const PORT = process.env.CDP_PORT ?? '19222'
const OUT = process.env.OUT_DIR ?? '/tmp/dch-ui'
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(0) }, 90000)

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('19387'))
if (!page) { console.log('no Host page in the browser'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
await new Promise(r => { ws.onopen = r })
await send('Page.enable'); await send('Runtime.enable')
const evaluate = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, expression })).result?.value

// 1. fresh build, fresh page: reload before measuring anything
await send('Page.reload', { ignoreCache: true })
await new Promise(r => setTimeout(r, 9000))
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(e => (e.textContent||'').trim() === '继续'); if (b) b.click() })()`)
await new Promise(r => setTimeout(r, 1200))

// 2. open the panel and prove it opened
const opened = await evaluate(`(() => {
  const el = [...document.querySelectorAll('*')].filter(e => (e.textContent||'').trim() === 'Computer History')
    .map(e => e.closest('button,[role="button"],a,[data-slot]')).filter(Boolean)[0]
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
