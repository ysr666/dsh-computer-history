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
]

// This file defines the denylist, so it necessarily contains the tokens it
// forbids. It is the only file exempt from its own scan: the check would
// otherwise always fail once scripts/ is scanned.
const SELF = 'verify-privacy-boundary.mjs'

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (entry.name === SELF) return []
    return /\.(swift|ts|tsx|js|mjs)$/.test(entry.name) ? [full] : []
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

if (violations.length) {
  console.error(violations.join('\n'))
  process.exit(1)
}
