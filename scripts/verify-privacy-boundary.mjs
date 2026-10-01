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

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(swift|ts|tsx|js|mjs)$/.test(entry.name) ? [full] : []
  }))
  return nested.flat()
}

const roots = ['src', 'native']
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
