// Options page for the companion extension.
//
// This page is the extension's own UI, so it is the one place allowed to touch
// the DOM; `verify:privacy` applies its no-content rule to the worker and
// lib.js, not here. It never reads a page's content.
import { ext } from './engine.js'
import { checkPairing, pairingFromHash } from './lib.js'

const portInput = document.getElementById('port')
const tokenInput = document.getElementById('token')
const status = document.getElementById('status')

function show(message) {
  status.textContent = message
}

async function load() {
  const stored = await ext.storage.local.get([
    'companionPort',
    'companionToken',
  ])
  portInput.value = String(stored.companionPort ?? 19388)
  // The token is never shown back: only its digest exists on the host, so there
  // is nothing to display. A stored value is preserved on save unless replaced.
  if (typeof stored.companionToken === 'string' && stored.companionToken) {
    show('A pairing token is stored. Paste a new one to replace it.')
  }
  // One-click pairing: the panel can open this page with the token in the fragment. Nothing is trusted from it
  // beyond what pairingFromHash accepts, the fragment is cleared as soon as it has been used (so the token does
  // not sit in the address bar or the history), and pairing is verified before this reports success - a token
  // that was installed but does not authenticate must not look like one that worked.
  const fromLink = pairingFromHash(window.location.hash)
  if (fromLink.token) {
    if (fromLink.port !== undefined) portInput.value = String(fromLink.port)
    tokenInput.value = fromLink.token
    await save()
    await test()
    history.replaceState(null, '', window.location.pathname)
  }
}

async function save() {
  const port = Number(portInput.value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    show('Port must be a number between 1 and 65535.')
    return
  }
  const update = { companionPort: port }
  const token = tokenInput.value.trim()
  if (token.length > 0) update.companionToken = token
  await ext.storage.local.set(update)
  tokenInput.value = ''
  show(`Saved. Reporting to 127.0.0.1:${port}.`)
}

async function test() {
  const stored = await ext.storage.local.get([
    'companionPort',
    'companionToken',
  ])
  const port = Number(stored.companionPort ?? portInput.value)
  const token = tokenInput.value.trim().length > 0
    ? tokenInput.value.trim()
    : String(stored.companionToken ?? '')
  if (!token) {
    show('Paste the pairing token first (the panel shows it once).')
    return
  }
  try {
    const ok = await checkPairing(fetch, { port, token })
    show(ok
      ? `Paired: the intake on port ${port} accepted the token.`
      : `The intake answered, but not as paired. Rotate the token in the panel and paste the new one.`)
  } catch {
    show(`No intake on 127.0.0.1:${port}. Is the Computer History plugin running?`)
  }
}

document.getElementById('save').addEventListener('click', () => { void save() })
document.getElementById('test').addEventListener('click', () => { void test() })
void load()
