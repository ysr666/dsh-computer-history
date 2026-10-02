// Direct-drive probe for the Phase 1 collector: runs the real binary over
// stdio NDJSON and records raw observations before any Host filtering.
//
//   node scripts/verify/live-probe.mjs --allow <bundle[,bundle...]> [options]
//
// Options
//   --allow <list>     allowedBundleIds to send (default: all Phase 1 adapters)
//   --protect <list>   protectedPathPatterns to send (default: none)
//   --seconds <n>      how long to probe (default 20)
//   --log <path>       NDJSON output (default: /tmp/dsh-ch-probe-<pid>.log)
//   --binary <path>    collector binary (default bin/dsh-computer-history-collector)
//   --help             this text
//
// Exit codes: 0 on a clean shutdown, 1 when the binary is missing.
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_ALLOW = [
  'com.microsoft.VSCode',
  'com.todesktop.230313mzl4w4u92',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.apple.Preview',
  'com.apple.finder',
].join(',')

function parseArguments(argv) {
  const options = {
    allow: DEFAULT_ALLOW,
    protect: '',
    seconds: 20,
    log: undefined,
    binary: 'bin/dsh-computer-history-collector',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    switch (flag) {
      case '--allow': options.allow = value; index += 1; break
      case '--protect': options.protect = value; index += 1; break
      case '--seconds': options.seconds = Number(value); index += 1; break
      case '--log': options.log = value; index += 1; break
      case '--binary': options.binary = value; index += 1; break
      case '--help':
      case '-h':
        printUsage()
        process.exit(0)
      default:
        console.error(`unknown option: ${flag}`)
        printUsage()
        process.exit(2)
    }
  }
  return options
}

function printUsage() {
  const text = [
    'Usage: node scripts/verify/live-probe.mjs [options]',
    '',
    '  --allow <list>     comma separated bundle ids to allow',
    '  --protect <list>   comma separated protected path globs',
    '  --seconds <n>      probe duration (default 20)',
    '  --log <path>       NDJSON log path',
    '  --binary <path>    collector binary path',
    '  --help             show this text',
    '',
    'The probe sends one configure message, then records every NDJSON line the',
    'collector writes. It never writes to a Computer History database: the raw',
    'stream is the evidence, and the collector is shut down with a protocol',
    'shutdown before SIGTERM.',
  ].join('\n')
  console.log(text)
}

const options = parseArguments(process.argv.slice(2))
const binary = path.resolve(options.binary)
if (!existsSync(binary)) {
  console.error(
    `collector binary not found at ${binary}; run pnpm native:build first`,
  )
  process.exit(1)
}

const logPath = options.log ?? `/tmp/dsh-ch-probe-${process.pid}.log`
const out = createWriteStream(logPath, { flags: 'a' })
const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })

const allowed = options.allow.split(',').map(part => part.trim()).filter(Boolean)
const protect = options.protect.split(',').map(part => part.trim()).filter(Boolean)

let buffer = ''
let configured = false

function handle(line) {
  out.write(line + '\n')
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.type === 'hello' && !configured) {
    configured = true
    child.stdin.write(JSON.stringify({
      v: 1,
      type: 'configure',
      revision: 1,
      policy: {
        mode: 'include-only',
        allowedBundleIds: allowed,
        blockedBundleIds: [],
        protectedBundleIds: [],
        protectedPathPatterns: protect,
      },
    }) + '\n')
  }
}

child.stdout.on('data', chunk => {
  buffer += chunk.toString('utf8')
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) handle(line)
  }
})

child.stderr.on('data', chunk => out.write('STDERR ' + chunk.toString()))

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  try {
    child.stdin.write(JSON.stringify({
      v: 1,
      type: 'shutdown',
      reason: 'host-shutdown',
    }) + '\n')
  } catch {}
  setTimeout(() => {
    child.kill('SIGTERM')
    out.end()
    console.log(`probe log: ${logPath}`)
    process.exit(0)
  }, 1200)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
setTimeout(shutdown, options.seconds * 1000)
