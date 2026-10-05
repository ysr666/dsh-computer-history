import type { HistoryApiSuffix } from './api-route.js'
import { historyApi } from './api.js'

/**
 * Start a Desktop-safe download from a Host route.
 *
 * DSH Desktop's browser download manager handles document-relative Host URLs,
 * while blob:/data: URLs are not reliable under the dsh-app:// scheme. Mirror
 * the built-in Session export flow: prove the route with HEAD, then hand the
 * same route to the browser download manager.
 */
export async function downloadHistoryRoute(
  path: HistoryApiSuffix,
): Promise<void> {
  const route = await historyApi.prepareDownloadRoute(path)
  const anchor = window.document.createElement('a')
  anchor.href = route.href
  anchor.download = route.filename ?? 'computer-history.json'
  anchor.click()
}
