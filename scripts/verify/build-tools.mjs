// Build the verification helpers (AX probe and the idle-gated activation tool)
// into bin/verify/.
//
//   pnpm verify:tools
//
// They are only used by the real-machine recipes in docs/verification-guide.md.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  requireMacOS,
  run,
  sdkPath,
  swiftc,
} from './toolchain.mjs'

requireMacOS('verify tools build')

const outputDir = 'bin/verify'
mkdirSync(outputDir, { recursive: true })

const tools = [
  {
    source: 'scripts/verify/ax-probe.swift',
    output: path.join(outputDir, 'ax-probe'),
    frameworks: ['ApplicationServices'],
  },
  {
    source: 'scripts/verify/activate.swift',
    output: path.join(outputDir, 'activate'),
    frameworks: ['AppKit', 'ApplicationServices'],
  },
]

for (const tool of tools) {
  run(swiftc, [
    '-O',
    '-sdk', sdkPath,
    tool.source,
    '-o', tool.output,
    ...tool.frameworks.flatMap(name => ['-framework', name]),
  ])
}

console.log(
  `built verification helpers: ${tools
    .map(tool => tool.output)
    .join(', ')}`,
)
