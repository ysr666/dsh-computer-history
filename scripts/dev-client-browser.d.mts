export interface DevBrowserOptions {
  url: string
  chromeBin: string
  puppeteerEntry: string
  headless?: boolean
  reloadMode?: 'page' | 'native-hmr'
}
export function validateDevBrowserOptions(options: DevBrowserOptions): DevBrowserOptions
export function openDevBrowser(
  options: DevBrowserOptions,
  dependencies?: { loadPuppeteer?: () => Promise<{ default?: unknown; launch?: unknown }> },
): Promise<{ reload(): Promise<void>; close(): Promise<void> }>
