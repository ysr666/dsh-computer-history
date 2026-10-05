#!/usr/bin/env node
// One command for the Linux flow: build the collector inside a container, and make it answer in both of the
// states that matter.
//
//   pnpm e2e:linux
//
// It starts colima if it is not running, copies the collector's source into the VM (the binary has to be built
// for Linux, and building it here would be cross-compilation for no reason), and runs it twice:
//
//   * with no accessibility bus reachable - it has to say `permission-required`, `accessibilityTrusted: false`
//     and a reason, because "the collector cannot see anything" and "nobody used the machine" must not look the
//     same (that is the defect this pair of runs was written against);
//   * with a real session - Xvfb, a session bus and the AT-SPI registry, the same recipe the first live Linux
//     run used - where it has to say `running`.
//
// Artifacts land in .debug/e2e-linux/run-<stamp>/. Needs colima and its VM; anything missing is named.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)

const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(REPO, '.debug', 'e2e-linux', `run-${stamp}`)
mkdirSync(artifacts, { recursive: true })

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`)
}
const host = (args) => spawnSync('colima', args, { encoding: 'utf8' })
const vm = (script) => spawnSync('colima', ['ssh', '--', 'bash', '-c', script], { encoding: 'utf8' })

// A missing tool has to be a sentence, not a stack trace or a silent pass.
if (host(['version']).status !== 0) {
  console.error('colima is not installed: install it (https://github.com/abiosoft/colima) to run the Linux flow')
  process.exit(1)
}
if (host(['status']).status !== 0) {
  console.log('colima is not running: starting it (this takes about a minute)')
  const started = host(['start'])
  if (started.status !== 0) {
    console.error(`colima did not start: ${(started.stderr ?? '').trim().split('\n').slice(-1)[0] ?? 'no output'}`)
    process.exit(1)
  }
}
record('colima', true, 'running')

// The collector is built where it will run: the VM is Linux, this machine is not.
const packed = spawnSync('tar', ['--exclude=target', '-czf', '-', 'native'], { encoding: 'buffer', maxBuffer: 1 << 28 })
if (packed.status !== 0) {
  record('collector source', false, 'tar failed')
} else {
  const copied = spawnSync('colima', ['ssh', '--', 'bash', '-c', 'rm -rf ~/src && mkdir -p ~/src && tar -xzf - -C ~/src'], {
    input: packed.stdout,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
  record('copy source', copied.status === 0, copied.status === 0 ? 'native/ is in the VM' : (copied.stderr ?? '').trim().slice(-140))
}
const build = vm('cd ~/src/native/linux && cargo build --release 2>&1 | tail -3 && ls -l target/release/dsh-computer-history-collector-linux | awk \'{print $5}\'')
writeFileSync(path.join(artifacts, 'build.log'), `${build.stdout ?? ''}${build.stderr ?? ''}`)
record('build in the VM', build.status === 0, build.status === 0 ? `${(build.stdout ?? '').trim().split('\n').slice(-1)[0] ?? ''} bytes` : (build.stderr ?? '').trim().slice(-140))

const CONFIGURE = JSON.stringify({
  v: 1, type: 'configure', revision: 1,
  policy: { mode: 'include-only', allowedBundleIds: [], blockedBundleIds: [], protectedBundleIds: [], protectedPathPatterns: [] },
})
const runCollector = (env) => vm(
  `(printf '%s\\n' '${CONFIGURE}'; sleep 5) | ${env} ~/src/native/linux/target/release/dsh-computer-history-collector-linux 2>&1 | grep -m1 '"type":"state"'`,
)

// 1. No bus reachable. The old build answered `running` + `accessibilityTrusted: true` here, which is the
// failure this run exists to prevent from coming back.
const noBus = runCollector('DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/nonexistent-bus')
const noBusLine = (noBus.stdout ?? '').trim().split('\n').slice(-1)[0] ?? ''
writeFileSync(path.join(artifacts, 'state-no-bus.txt'), `${noBusLine}\n`)
record(
  'no bus: named, not silent',
  noBusLine.includes('"state":"permission-required"') && noBusLine.includes('"accessibilityTrusted":false') && noBusLine.includes('"reason":"'),
  noBusLine.slice(0, 150) || '(no state line at all)',
)

// 2. A real session: the recipe the first live Linux run used (Xvfb, a session bus, the AT-SPI registry).
const session = vm(`export DISPLAY=:99
# Kill the previous Xvfb through the pid file it wrote, never with \`pkill -f\`: the command line of the shell
# running this very script contains the string "Xvfb :99", so a pattern match kills the script itself - measured
# 2026-10-05, which is why the first version of this check reported "no state line at all" instead of a state.
if [ -f /tmp/xvfb.pid ]; then kill "$(cat /tmp/xvfb.pid)" 2>/dev/null || true; sleep 1; fi
setsid Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 < /dev/null &
echo $! > /tmp/xvfb.pid
sleep 1
ADDRESS=$(dbus-daemon --session --fork --print-address 2>/dev/null)
export DBUS_SESSION_BUS_ADDRESS="$ADDRESS"
setsid /usr/libexec/at-spi-bus-launcher --launch-immediately >/dev/null 2>&1 < /dev/null &
sleep 2
(printf '%s\\n' '${CONFIGURE}'; sleep 5) | ~/src/native/linux/target/release/dsh-computer-history-collector-linux 2>&1 | grep -m1 '"type":"state"'`)
const sessionLine = (session.stdout ?? '').trim().split('\n').slice(-1)[0] ?? ''
writeFileSync(path.join(artifacts, 'state-with-session.txt'), `${sessionLine}\n`)
const launcherMissing = /No such file or directory/.test(`${session.stderr ?? ''}`)
record(
  'session: observes',
  sessionLine.includes('"state":"running"'),
  sessionLine.slice(0, 150) || (launcherMissing ? 'at-spi2-core is not installed in the VM (apt-get install at-spi2-core xvfb dbus-x11)' : '(no state line at all)'),
)

writeFileSync(path.join(artifacts, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`)
const failed = checks.filter(check => !check.ok)
console.log(`\nartifacts: ${path.relative(REPO, artifacts)}`)
if (failed.length > 0) {
  console.error(`e2e (Linux) failed: ${failed.map(check => `${check.name} (${check.detail})`).join('; ')}`)
  process.exit(1)
}
console.log(`e2e (Linux) passed: ${checks.length} checks - the collector names what it cannot do, and observes when it can`)
