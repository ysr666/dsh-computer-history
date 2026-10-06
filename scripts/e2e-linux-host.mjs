#!/usr/bin/env node
// Full Linux desktop acceptance: a real Linux collector observes a real Nautilus window, then the normal
// throwaway DSH Host persists that observation and materializes an Episode. The Host itself runs on the
// development machine; the collector and the desktop it observes run inside Colima's Linux VM.
//
// This complements e2e-linux.mjs. That command owns the collector's two accessibility states; this command
// proves the current Host -> subprocess -> Linux collector -> ingestion -> SQLite -> /recent path.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)

const host = args => spawnSync('colima', args, { encoding: 'utf8' })
const vm = script => spawnSync('colima', ['ssh', '--', 'bash', '-lc', script], { encoding: 'utf8' })

const fail = (message, result) => {
  const detail = `${result?.stdout ?? ''}${result?.stderr ?? ''}`.trim()
  console.error(`e2e (Linux Host) failed: ${message}${detail ? `\n${detail}` : ''}`)
  process.exit(1)
}

if (host(['version']).status !== 0) {
  fail('colima is not installed')
}
if (host(['status']).status !== 0) {
  const started = host(['start'])
  if (started.status !== 0) fail('colima did not start', started)
}

// Reuse the collector-level acceptance as the build step. It copies the current checkout into Linux, builds
// there, proves both accessibility states and leaves no desktop processes behind.
const collectorGate = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'e2e-linux.mjs')], {
  cwd: REPO,
  env: process.env,
  stdio: 'inherit',
})
if (collectorGate.status !== 0) process.exit(collectorGate.status ?? 1)

const cleanup = () => vm(`
for f in /tmp/dch-host-nautilus.pid /tmp/dch-host-openbox.pid /tmp/dch-host-atspi.pid /tmp/dch-host-xvfb.pid /tmp/dch-host-dbus.pid; do
  if [ -f "$f" ]; then kill $(cat "$f") 2>/dev/null || true; fi
done
rm -f /tmp/dch-host-*.pid /tmp/dch-host-dbus.addr
true
`)

cleanup()

const session = vm(`
set -e
export DISPLAY=:99
setsid Xvfb :99 -screen 0 1280x800x24 >/tmp/dch-host-xvfb.log 2>&1 < /dev/null &
echo $! >/tmp/dch-host-xvfb.pid
sleep 1

dbus-daemon --session --fork --print-address=3 --print-pid=4 3>/tmp/dch-host-dbus.addr 4>/tmp/dch-host-dbus.pid
export DBUS_SESSION_BUS_ADDRESS="$(cat /tmp/dch-host-dbus.addr)"
gsettings set org.gnome.desktop.interface toolkit-accessibility true

setsid /usr/libexec/at-spi-bus-launcher --launch-immediately >/tmp/dch-host-atspi.log 2>&1 < /dev/null &
echo $! >/tmp/dch-host-atspi.pid
setsid openbox >/tmp/dch-host-openbox.log 2>&1 < /dev/null &
echo $! >/tmp/dch-host-openbox.pid
sleep 2

setsid nautilus --new-window "$HOME" >/tmp/dch-host-nautilus.log 2>&1 < /dev/null &
echo $! >/tmp/dch-host-nautilus.pid

window=""
for _ in $(seq 1 12); do
  window="$(xdotool search --onlyvisible --class org.gnome.Nautilus 2>/dev/null | head -1 || true)"
  [ -n "$window" ] && break
  sleep 1
done
[ -n "$window" ]
xdotool windowactivate --sync "$window"
sleep 1
printf 'active=%s\n' "$(xdotool getactivewindow getwindowname)"
`)
const activeLine = session.stdout.trim().split('\n').find(line => line.startsWith('active='))
if (session.status !== 0 || !activeLine || activeLine === 'active=') {
  cleanup()
  fail('the Linux desktop did not produce an active Nautilus window', session)
}
console.log(`  ✓ Linux desktop: ${activeLine}`)

const wrapperDir = mkdtempSync(path.join(os.tmpdir(), 'dch-linux-collector-'))
const wrapper = path.join(wrapperDir, 'collector.sh')
writeFileSync(wrapper, `#!/bin/sh
exec colima ssh -- bash -lc 'export DISPLAY=:99; export DBUS_SESSION_BUS_ADDRESS="$(cat /tmp/dch-host-dbus.addr)"; exec "$HOME/src/native/linux/target/release/dsh-computer-history-collector-linux"'
`)
chmodSync(wrapper, 0o755)

// e2e-macos.mjs is the repository's generic throwaway-Host harness despite its historical name. Supplying an
// explicit collector makes its collector handshake strict. Explicit Linux bundle ids avoid borrowing the Mac
// first-run preset, and EXPECT_ACTIVITY upgrades the store check from reporting to an assertion.
const hostGate = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'e2e-macos.mjs')], {
  cwd: REPO,
  env: {
    ...process.env,
    COLLECTOR_EXECUTABLE: wrapper,
    DSH_E2E_ALLOW_BUNDLES: 'org.gnome.Nautilus.desktop',
    DSH_E2E_EXPECT_ACTIVITY: '1',
    DSH_E2E_EXPECT_PROVIDER: 'at-spi',
    DSH_E2E_ACTIVITY_TIMEOUT_MS: '25000',
  },
  stdio: 'inherit',
})

cleanup()
rmSync(wrapperDir, { recursive: true, force: true })

if (hostGate.status !== 0) process.exit(hostGate.status ?? 1)
console.log('e2e (Linux Host) passed: real Nautilus -> AT-SPI collector -> Host -> SQLite -> /recent')
