export const HISTORY_API_RELATIVE_PREFIX =
  'api/computer-history'

export type HistoryApiSuffix = `/${string}`

export function historyApiPath(path: HistoryApiSuffix): string {
  if (!path.startsWith('/')) {
    throw new Error('history API path must start with /')
  }
  return HISTORY_API_RELATIVE_PREFIX + path
}
