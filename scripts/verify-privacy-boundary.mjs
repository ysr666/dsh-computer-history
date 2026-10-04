import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const forbidden = [
  'AXValue',
  'AXSelectedText',
  'AXNumberOfCharacters',
  'AXVisibleCharacterRange',
  'ScreenCaptureKit',
  'CGWindowListCreateImage',
  'CGEventTapCreate',
  'addGlobalMonitorForEvents',
  'AVAudioEngine',
  'AVCaptureSession',
  // Windows UI Automation content surfaces: a value/text/selection pattern read is content, and the
  // key/screenshot APIs are outside ADR 0002 exactly like their macOS counterparts are.
  'ValuePattern',
  'TextPattern',
  'SelectionPattern',
  'CurrentValue',
  'GetCurrentPattern',
  'DocumentRange',
  'GetClipboardData',
  'keybd_event',
  'BitBlt',
  'PrintWindow',
]

// Build outputs are not source: an .rmeta file contains every API name of its dependencies, so
// scanning them would report a violation for every token the dependency defines.
const skipDirectories = new Set([
  'node_modules',
  'target',
  'dist',
  'coverage',
  '.build',
  '.swiftpm',
  '.git',
])

// This file defines the denylist, so it necessarily contains the tokens it
// forbids. It is the only file exempt from its own scan: the check would
// otherwise always fail once scripts/ is scanned.
const SELF = 'verify-privacy-boundary.mjs'

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return skipDirectories.has(entry.name) ? [] : walk(full)
    }
    if (entry.name === SELF) return []
    return /\.(swift|ts|tsx|js|mjs|rs)$/.test(entry.name) ? [full] : []
  }))
  return nested.flat()
}

// The verification helpers under scripts/ are scanned too: they touch the
// Accessibility API directly, so they must respect the same boundary as the
// collector they exercise.
const roots = ['src', 'native', 'scripts', 'extension']
const rootFiles = await Promise.all(roots.map(async (root) => {
  try {
    return await walk(root)
  } catch {
    return []
  }
}))
const files = rootFiles.flat()

const contents = await Promise.all(files.map(async (file) => ({
  file,
  text: await readFile(file, 'utf8'),
})))

const violations = contents.flatMap(({ file, text }) =>
  forbidden
    .filter((token) => text.includes(token))
    .map((token) => `${file}: forbidden symbol ${token}`),
)

// The companion's worker and shared logic must not touch page content. The
// options page is the extension's own UI and is exempt: it may use the DOM of
// its own document, and it never reads a page.
const contentApis = [
  'document.',
  'innerText',
  'textContent',
  'getSelection',
  'querySelector',
  'localStorage',
]
const extensionFiles = [
  'extension/lib.js',
  'extension/service-worker.js',
]
const extensionSources = new Map(
  (
    await Promise.all(
      extensionFiles.map(async file => {
        try {
          return [file, await readFile(file, 'utf8')]
        } catch {
          return undefined
        }
      }),
    )
  ).filter(entry => entry !== undefined),
)
for (const [file, text] of extensionSources) {
  for (const token of contentApis) {
    if (text.includes(token)) {
      violations.push(`${file}: page-content API ${token}`)
    }
  }
}

// The denylist is only worth anything if the comparison against it still works:
// a scan that finds nothing looks exactly like a clean codebase.
{
  const catches = sample => forbidden.some(token => sample.includes(token))
  if (!catches('const value = element.AXValue')) {
    violations.push('the denylist no longer catches a forbidden API - this guard proves nothing')
  }
  if (!catches('let pattern = element.GetCurrentPattern(PATTERN)')) {
    violations.push('the denylist no longer catches a UIA content API - this guard proves nothing')
  }
  if (catches('const value = element.AXTitle')) {
    violations.push('the denylist catches a token it should not')
  }
  if (contents.length === 0) {
    violations.push('no source files were read - this guard proves nothing')
  }
}

if (violations.length) {
  console.error(violations.join('\n'))
  process.exit(1)
}

// Say so when it passes: a guard that is silent on success is indistinguishable
// from a guard that never ran.
console.log(
  `privacy boundary holds: ${contents.length} source files scanned, `
  + `${forbidden.length} forbidden APIs and ${contentApis.length} content APIs denied`,
)
