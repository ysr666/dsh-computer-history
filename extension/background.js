// The companion's wiring, written once for every engine.
//
// The worker listens to tab activation and navigation, and hands the tab to the pure
// logic in lib.js. It reads no page content: the only fields it touches are the tab's
// url, title and incognito flag.
//
// Both the Chromium service worker and the Gecko event page load this file; the only
// engine-specific part is the namespace `engine.js` resolves. The manifest decides how
// this file is started, not what it does.
import { ext } from './engine.js'
import {
  buildPayload,
  sendObservation,
  shouldReportTab,
} from './lib.js'

const DEFAULT_PORT = 19388

let seq = 0
// The Host deduplicates by (session, seq). Keep those lifetimes identical: MV3 may destroy and recreate this
// worker at any time, so a persisted session paired with an in-memory sequence would replay seq=1..N and be
// silently dropped after every worker restart.
const session = `browser-${crypto.randomUUID()}`
let config = { port: DEFAULT_PORT, token: '' }

async function loadConfig() {
  const stored = await ext.storage.local.get([
    'companionPort',
    'companionToken',
  ])
  config = {
    port: Number(stored.companionPort ?? DEFAULT_PORT),
    token: String(stored.companionToken ?? ''),
  }
  return config
}

async function reportTab(tab) {
  // Incognito first, before anything else is read or sent.
  if (!shouldReportTab(tab)) return
  if (config.token.length === 0) await loadConfig()
  if (config.token.length === 0) return
  seq += 1
  const payload = buildPayload(tab, session, seq)
  if (!payload) return
  try {
    const result = await sendObservation(fetch, config, payload)
    if (result.status === 202 && result.stored === false) {
      console.debug(
        'companion: observation not stored',
        result.reason ?? 'policy-or-duplicate',
      )
    } else if (result.status >= 400 && result.status !== 429) {
      console.debug('companion: intake answered', result.status)
    }
  } catch (error) {
    // The intake is not running, or the token is wrong: stay quiet and let the
    // options page's pairing check tell the user.
    console.debug('companion: intake unreachable', String(error))
  }
}

async function reportActiveTab(windowId) {
  const [tab] = await ext.tabs.query({ active: true, windowId })
  if (tab) await reportTab(tab)
}

export function startCompanion() {
  ext.tabs.onActivated.addListener(async info => {
    await reportActiveTab(info.windowId)
  })

  ext.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return
    if (!tab.active) return
    await reportTab(tab)
  })

  ext.windows.onFocusChanged.addListener(async windowId => {
    if (windowId === ext.windows.WINDOW_ID_NONE) return
    await reportActiveTab(windowId)
  })

  ext.runtime.onInstalled.addListener(() => {
    void loadConfig()
  })

  void loadConfig()
}
