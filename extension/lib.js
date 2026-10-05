// Pure logic for the companion extension (ADR 0007).
//
// Everything that can be reasoned about without a browser lives here so the
// tests can drive it: the incognito refusal, the URL normalisation, the payload
// shape, and the transport call. `service-worker.js` only wires Chrome events
// to these functions.
//
// Nothing in this file reads page content. There is no DOM API, no selection,
// no form value, and `verify:privacy` fails if one appears.

/** Schemes worth reporting: a page a person was actually reading. */
const REPORTABLE_SCHEMES = new Set(['http:', 'https:'])

/**
 * Whether a tab may be reported at all. Incognito is checked first and on its
 * own, because it is the one condition that must never depend on anything
 * else.
 */
export function shouldReportTab(tab) {
  if (!tab || typeof tab !== 'object') return false
  if (tab.incognito === true) return false
  if (typeof tab.url !== 'string') return false
  return isReportableUrl(tab.url)
}

export function isReportableUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return REPORTABLE_SCHEMES.has(url.protocol)
}

/**
 * Origin plus path, with the query string and the fragment removed. A URL can
 * carry a token or a search term, and neither belongs in a work history.
 */
export function normalizeUrl(raw) {
  const url = new URL(raw)
  return { origin: url.origin, path: url.pathname }
}

export function buildPayload(tab, session, seq, observedAtMs = Date.now()) {
  if (!shouldReportTab(tab)) return undefined
  const { origin, path } = normalizeUrl(tab.url)
  const title = typeof tab.title === 'string' && tab.title.length > 0
    ? tab.title.slice(0, 1024)
    : undefined
  return {
    // The intake switches on this field: without it every payload is answered
    // `400 source must be "browser" or "editor"`, and the extension reports that only at console.debug. A live
    // run on 2026-10-05 found the row missing for exactly this reason.
    source: 'browser',
    origin,
    path,
    ...(title === undefined ? {} : { title }),
    incognito: false,
    browserSession: session,
    seq,
    observedAtMs,
  }
}

/**
 * @typedef {object} CompanionConfig
 * @property {number} port
 * @property {string} token
 */

/**
 * @param {typeof fetch} fetchImpl
 * @param {CompanionConfig} config
 * @param {object} payload
 * @returns {Promise<number>} the intake's HTTP status
 */
export async function sendObservation(
  fetchImpl,
  config,
  payload,
) {
  const response = await fetchImpl(
    `http://127.0.0.1:${config.port}/companion/observation`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': config.token,
      },
      body: JSON.stringify(payload),
    },
  )
  return response.status
}

/**
 * Health check used by the options page before it saves a pairing.
 * @param {typeof fetch} fetchImpl
 * @param {CompanionConfig} config
 * @returns {Promise<boolean>}
 */
export async function checkPairing(fetchImpl, config) {
  const response = await fetchImpl(
    `http://127.0.0.1:${config.port}/companion/health`,
    { headers: { 'x-companion-token': config.token } },
  )
  return response.status === 200
}
