import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  'dsh-cli',
)
const args = [
  'install',
  '--prefix', root,
  '@deepseek-ai/dsh@0.2.0-rc.2',
]

const quoteForCmd = value => (
  /[\s"]/.test(String(value))
    ? `"${String(value).replaceAll('"', '\\"')}"`
    : String(value)
)

const result = process.platform === 'win32'
  ? spawnSync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', ['npm', ...args].map(quoteForCmd).join(' ')],
      {
        stdio: 'inherit',
        windowsVerbatimArguments: true,
      },
    )
  : spawnSync('npm', args, { stdio: 'inherit' })

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)

const bin = path.join(root, 'node_modules', '.bin')
const githubPath = process.env.GITHUB_PATH
if (!githubPath) {
  console.error('GITHUB_PATH is unavailable')
  process.exit(1)
}
appendFileSync(githubPath, bin + os.EOL)
console.log(`installed DSH CLI 0.2.0-rc.2 under ${root}`)
