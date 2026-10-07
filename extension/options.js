// Options page for the companion extension.
//
// This page is the extension's own UI, so it is the one place allowed to touch
// the DOM; privacy verification applies its no-content rule to the worker and
// lib.js, not here. It never reads a page's content.
import { ext } from './engine.js'
import { checkPairing, pairingFromHash } from './lib.js'

const portInput = document.getElementById('port')
const tokenInput = document.getElementById('token')
const status = document.getElementById('status')
const connectionState = document.getElementById('connection-state')
const connectionLabel = document.getElementById('connection-label')

function message(key, substitutions, fallback = key) {
  const translated = ext.i18n?.getMessage?.(key, substitutions)
  return typeof translated === 'string' && translated.length > 0
    ? translated
    : fallback
}

function localizePage() {
  const language = ext.i18n?.getUILanguage?.()
  if (language) document.documentElement.lang = language
  const title = ext.i18n?.getMessage?.('pageTitle')
  if (title) document.title = title

  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n')
    if (!key) continue
    const translated = ext.i18n?.getMessage?.(key)
    if (translated) node.textContent = translated
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = node.getAttribute('data-i18n-placeholder')
    if (!key) continue
    const translated = ext.i18n?.getMessage?.(key)
    if (translated) node.setAttribute('placeholder', translated)
  }
}

function show(text, tone = 'info') {
  status.textContent = text
  status.dataset.tone = tone
  status.hidden = false
}

function setConnection(label, tone = 'idle') {
  connectionLabel.textContent = label
  connectionState.dataset.tone = tone
}

function portValue() {
  const port = Number(portInput.value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    show(message('portInvalid', undefined, 'Port must be a number between 1 and 65535.'), 'error')
    return undefined
  }
  return port
}

async function load() {
  const stored = await ext.storage.local.get([
    'companionPort',
    'companionToken',
  ])
  portInput.value = String(stored.companionPort ?? 19388)
  // The token is never shown back. A stored value is preserved unless replaced.
  if (typeof stored.companionToken === 'string' && stored.companionToken) {
    setConnection(message('pairingSaved', undefined, 'Pairing saved'))
    show(message(
      'storedToken',
      undefined,
      'A pairing token is stored. Test the connection, or paste a new token to replace it.',
    ))
  } else {
    setConnection(message('notPaired', undefined, 'Not paired'))
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
  const port = portValue()
  if (port === undefined) return
  const update = { companionPort: port }
  const token = tokenInput.value.trim()
  if (token.length > 0) update.companionToken = token
  await ext.storage.local.set(update)
  tokenInput.value = ''
  setConnection(message('settingsSaved', undefined, 'Settings saved'))
  show(message(
    'savedLocal',
    [String(port)],
    `Saved locally. Browser metadata will be sent to 127.0.0.1:${port}.`,
  ), 'success')
}

async function test() {
  const stored = await ext.storage.local.get([
    'companionPort',
    'companionToken',
  ])
  const port = portValue()
  if (port === undefined) return
  const typedToken = tokenInput.value.trim()
  const token = typedToken.length > 0
    ? typedToken
    : String(stored.companionToken ?? '')
  if (!token) {
    setConnection(message('tokenNeeded', undefined, 'Token needed'), 'error')
    show(message(
      'tokenNeededBody',
      undefined,
      'Paste the pairing token shown once in Computer History first.',
    ), 'error')
    return
  }

  setConnection(message('checking', undefined, 'Checking…'))
  show(message('checkingBody', undefined, 'Checking the local Computer History intake…'))
  try {
    const ok = await checkPairing(fetch, { port, token })
    if (ok) {
      await ext.storage.local.set({
        companionPort: port,
        ...(typedToken.length > 0 ? { companionToken: typedToken } : {}),
      })
      tokenInput.value = ''
      setConnection(message('connected', undefined, 'Connected'), 'success')
      show(message(
        'connectedBody',
        undefined,
        'Connected. Computer History accepted this browser companion.',
      ), 'success')
      return
    }
    setConnection(message('pairingRejected', undefined, 'Pairing rejected'), 'error')
    show(message(
      'pairingRejectedBody',
      undefined,
      'Computer History is reachable, but the token was not accepted. Create a new token in DSH and try again.',
    ), 'error')
  } catch {
    setConnection(message('offline', undefined, 'Computer History offline'), 'error')
    show(message(
      'offlineBody',
      [String(port)],
      `No Computer History intake is listening on 127.0.0.1:${port}. Open DSH and make sure Computer History is running.`,
    ), 'error')
  }
}

localizePage()
document.getElementById('save').addEventListener('click', () => { void save() })
document.getElementById('test').addEventListener('click', () => { void test() })
void load()
