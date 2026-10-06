// Types for the companion extension's shared logic. The implementation stays
// plain ESM JavaScript because Chrome loads it directly; this declaration is
// what keeps the tests and any future `checkJs` honest about the contract.

export interface CompanionTab {
  readonly url?: string
  readonly title?: string
  readonly incognito?: boolean
}

export interface CompanionConfig {
  readonly port: number
  readonly token: string
}

export interface CompanionExtensionPayload {
  /** The intake switches on this field; a payload without it is answered 400 and never stored. */
  readonly source: 'browser'
  readonly origin: string
  readonly path: string
  readonly title?: string
  readonly incognito: false
  readonly browserSession: string
  readonly seq: number
  readonly observedAtMs: number
}

export function shouldReportTab(tab: CompanionTab | undefined): boolean
export function isReportableUrl(raw: string): boolean
export function normalizeUrl(raw: string): { origin: string; path: string }
export function buildPayload(
  tab: CompanionTab,
  session: string,
  seq: number,
  observedAtMs?: number,
): CompanionExtensionPayload | undefined
export function sendObservation(
  fetchImpl: typeof fetch,
  config: CompanionConfig,
  payload: CompanionExtensionPayload,
): Promise<{ readonly status: number; readonly stored?: boolean; readonly reason?: string }>
export function checkPairing(
  fetchImpl: typeof fetch,
  config: CompanionConfig,
): Promise<boolean>

export function pairingFromHash(hash: string): { token?: string; port?: number }
