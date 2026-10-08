#!/usr/bin/env node
/* oxlint-disable no-await-in-loop -- CDP polling/dismissal is intentionally sequential */
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const hostLog = process.env.CAPSULE_HOST_LOG ?? '/tmp/dsh-capsule-host.log'
const cdpPort = Number(process.env.CAPSULE_CDP_PORT ?? 19241)
const outDir = process.env.CAPSULE_OUT ?? '.debug/continuation-capsule-runtime'
const chromePath = process.env.CAPSULE_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sendAfterContinue = process.env.CAPSULE_SEND === '1'

const hostText = readFileSync(hostLog, 'utf8')
const host = /dsh web:\s+(http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+))/u.exec(hostText)
if (!host) {
  console.error('continuation capsule check: Host log has no local token URL')
  process.exit(2)
}
const url = host[1]
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

mkdirSync(outDir, { recursive: true })

async function ensureChrome() {
  const probe = async () => {
    try {
      return (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).ok
    } catch {
      return false
    }
  }
  if (await probe()) return
  const profile = path.join(outDir, 'chrome-profile')
  rmSync(profile, { recursive: true, force: true })
  const child = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--window-size=1600,1200',
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 40; i += 1) {
    await sleep(250)
    if (await probe()) return
  }
  throw new Error('Chrome did not expose CDP')
}

function connect(target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (!message.id || !pending.has(message.id)) return
      const entry = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    })
    ws.addEventListener('open', () => {
      const send = (method, params = {}) => new Promise((res, rej) => {
        const callId = ++id
        pending.set(callId, { resolve: res, reject: rej })
        ws.send(JSON.stringify({ id: callId, method, params }))
      })
      resolve({ ws, send })
    })
    ws.addEventListener('error', () => reject(new Error('CDP websocket failed')))
  })
}

await ensureChrome()
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
const page = targets.find(target => target.type === 'page')
if (!page) throw new Error('no page target')
const { ws, send } = await connect(page)
await send('Page.enable')
await send('Runtime.enable')
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  return result.result?.value
}
const shot = async name => {
  const result = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(outDir, name), Buffer.from(result.data, 'base64'))
}

await send('Page.navigate', { url })
await sleep(10_000)

for (let i = 0; i < 8; i += 1) {
  const dialogs = Number(await evaluate(
    'document.querySelectorAll(\'[role="dialog"],dialog\').length',
  ))
  if (dialogs === 0) break
  await evaluate(`(() => {
    const scope = document.querySelector('[role="dialog"],dialog') ?? document
    const buttons = [...scope.querySelectorAll('button')].filter(node => node.getClientRects().length > 0)
    const dismiss = buttons.find(node => /^(稍后|稍后配置|继续|知道了|关闭|Later|Configure later|Continue|Got it|Close|×)$/.test((node.textContent || '').trim()))
    const target = dismiss ?? buttons.at(-1)
    if (target) target.click()
  })()`)
  await sleep(700)
}

const openResult = await evaluate(`(() => {
  const all = [...document.querySelectorAll('button,[role="button"],a,[data-slot]')]
    .filter(node => node.getClientRects().length > 0)
  const target = all
    .filter(node => /Computer History|电脑使用记录/.test(
      [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')]
        .filter(Boolean).join(' '),
    ))
    .toSorted((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0]
  if (!target) return 'missing'
  target.click()
  return 'clicked'
})()`)
await sleep(3_500)

const panelPresent = Boolean(await evaluate("!!document.querySelector('.ch-main')"))
if (!panelPresent) {
  const body = String(await evaluate("document.body.innerText || ''"))
  writeFileSync(path.join(outDir, 'panel-missing.txt'), body)
  await shot('panel-missing.png')
  console.error('continuation capsule check: panel did not open:', openResult)
  console.error(body.slice(0, 1600))
  ws.close()
  process.exit(1)
}

const before = await evaluate(`(() => {
  const main = document.querySelector('.ch-main')
  const button = main?.querySelector('.ch-continue-primary')
  return {
    text: (main?.innerText || '').slice(0, 3000),
    continueLabel: (button?.textContent || '').trim(),
    continueDisabled: button?.disabled ?? null,
  }
})()`)
writeFileSync(path.join(outDir, 'before.json'), JSON.stringify(before, null, 2))
await shot('before-continue.png')

const clicked = await evaluate(`(() => {
  const button = document.querySelector('.ch-main .ch-continue-primary')
  if (!button) return 'missing'
  if (button.disabled) return 'disabled'
  button.click()
  return 'clicked'
})()`)
await sleep(2_500)

for (let i = 0; i < 5; i += 1) {
  const dismissed = await evaluate(`(() => {
    const scope = document.querySelector('[role="dialog"],dialog')
    if (!scope) return false
    const buttons = [...scope.querySelectorAll('button')]
      .filter(node => node.getClientRects().length > 0)
    const button = buttons.find(node =>
      /^(稍后|稍后配置|继续|知道了|关闭|Later|Configure later|Continue|Got it|Close|×)$/
        .test((node.textContent || '').trim()),
    )
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!dismissed) break
  await sleep(700)
}
await sleep(1_200)

const after = await evaluate(`(() => {
  const chip = document.querySelector('[data-composer-chip="computer-history"]')
  const editor = chip?.closest('[contenteditable="true"]')
    ?? document.querySelector('[contenteditable="true"]')
  const body = document.body.innerText || ''
  return {
    chipFound: !!chip,
    chipText: (chip?.textContent || '').trim(),
    chipTitle: chip?.querySelector('[title]')?.getAttribute('title')
      ?? chip?.getAttribute('title')
      ?? null,
    chipContentEditable: chip?.getAttribute('contenteditable') ?? null,
    chipHtml: chip?.outerHTML?.slice(0, 1200) ?? null,
    editorText: (editor?.textContent || '').trim(),
    visibleHiddenPrompt: /The user explicitly attached the Computer History Continue capsule|Before continuing, reopen or read the authoritative/.test(body),
    panelStillVisible: !!document.querySelector('.ch-main'),
    bodyTail: body.slice(-1800),
  }
})()`)
writeFileSync(path.join(outDir, 'after.json'), JSON.stringify(after, null, 2))
await shot('after-continue.png')

let sendCheck = { requested: sendAfterContinue, clicked: false, visibleHiddenPrompt: false }
if (sendAfterContinue && clicked === 'clicked' && after.chipFound === true) {
  const sendResult = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button[aria-label]')]
      .filter(node => node.getClientRects().length > 0 && !node.disabled)
    const button = buttons.find(node => /^(Send(?: message)?|发送(?:消息)?)(?:$|\\s)/.test(
      node.getAttribute('aria-label') || '',
    ))
    if (!button) {
      return {
        status: 'missing',
        labels: buttons.map(node => node.getAttribute('aria-label')).filter(Boolean),
      }
    }
    button.click()
    return { status: 'clicked', label: button.getAttribute('aria-label') }
  })()`)
  await sleep(5_000)
  const afterSend = await evaluate(`(() => {
    const body = document.body.innerText || ''
    const composerChip = document.querySelector(
      '[data-composer-chip="computer-history"]',
    )
    return {
      bodyTail: body.slice(-2200),
      composerChipPresent: !!composerChip,
      visibleHiddenPrompt: /## Computer History Continue|bounded bootstrap|workState\\.firstPass|computer-history:continuation-bootstrap/.test(body),
    }
  })()`)
  sendCheck = {
    requested: true,
    clicked: sendResult?.status === 'clicked',
    visibleHiddenPrompt: afterSend.visibleHiddenPrompt === true,
    sendResult,
    afterSend,
  }
  writeFileSync(
    path.join(outDir, 'after-send.json'),
    JSON.stringify(sendCheck, null, 2),
  )
  await shot('after-send.png')
}

const ok = clicked === 'clicked'
  && after.chipFound === true
  && after.chipText.includes('Computer History')
  && after.chipContentEditable === 'false'
  && after.visibleHiddenPrompt === false
  && (!sendAfterContinue || (
    sendCheck.clicked === true
    && sendCheck.visibleHiddenPrompt === false
  ))

console.log('panel:', openResult, '| Continue:', clicked)
console.log('before:', JSON.stringify(before))
console.log('after:', JSON.stringify(after))
if (sendAfterContinue) console.log('send:', JSON.stringify(sendCheck))
console.log(ok ? 'CONTINUATION_CAPSULE_OK' : 'CONTINUATION_CAPSULE_FAILED')
ws.close()
process.exit(ok ? 0 : 1)
