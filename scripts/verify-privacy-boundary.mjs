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
const roots = ['src', 'native', 'scripts']
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

if (violations.length) {
  console.error(violations.join('\n'))
  process.exit(1)
}
