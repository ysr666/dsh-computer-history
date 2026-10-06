#!/usr/bin/env node
// Judge the desktop-application path (① in the owner's baseline) from evidence that does not require a session in
// that application - because restarting it is one of the steps, and the restart ends whatever session is running
// inside it.
//
//   pnpm check:app-path
//
// It reads three facts and says which of the three steps have happened:
//   1. the plugin is in the desktop profile's dependencies *and* bundles (a dependency that is not a layer means
//      the profile does not load it at all);
//   2. the application started *after* that manifest and the plugin patch were last written (DSH loads bundles at
//      startup, so a manifest changed afterwards is not in the running process);
//   3. the store has observations - the first stored row is what "存下第一条观测" means.
//
// What it does not do: invent the action count. Three steps are three actions only if the owner reports no extra
// ones, so the verdict states the evidence and names who has to say the rest.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'

const home = os.homedir()
const profileDir = path.join(home, '.dsh', 'profiles', 'desktop')
const manifestPath = path.join(profileDir, 'package.json')
const patchPath = path.join(profileDir, 'cordis.patch.yml')
const storePath = path.join(home, '.dsh', 'computer-history', 'history.sqlite')

let pluginInstalled = false
let manifestMs
if (existsSync(manifestPath)) {
  manifestMs = statSync(manifestPath).mtimeMs
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const deps = Object.keys(manifest.dependencies ?? {})
  const bundles = ((manifest.dsh ?? {}).profile ?? {}).bundles ?? []
  pluginInstalled = deps.includes('dsh-computer-history') && bundles.includes('dsh-computer-history')
}
const patchMs = existsSync(patchPath) ? statSync(patchPath).mtimeMs : undefined

// The application's own start time, without touching it: the OS reports it.
const listing = spawnSync('ps', ['-eo', 'lstart,command'], { encoding: 'utf8' })
const appLine = (listing.stdout ?? '').split('\n').find(line => /DeepSeek Harness\.app\/Contents\/MacOS\/DeepSeek Harness/.test(line))
const appStartedMs = appLine ? Date.parse(appLine.trim().slice(0, 24)) : undefined
const restartNeeded = appStartedMs !== undefined && manifestMs !== undefined && appStartedMs < Math.max(manifestMs, patchMs ?? 0)

let observations
let allowedApps
try {
  const store = new DatabaseSync(storePath, { readOnly: true })
  observations = Number(store.prepare('select count(*) as n from observations').get().n)
  // Why a store can be empty while everything else looks healthy: `include-only` with no allow rule records
  // nothing at all, however well the collector runs. Measured 2026-10-06 on the owner's machine - capture
  // reported `running`, the collector was handshaken and trusted, `refusedByReason` was `{}` and the store stayed
  // at 0: the allow list was the whole story. An older store may not have the table yet, hence the separate try.
  try {
    allowedApps = Number(store.prepare(
      "select count(*) as n from policy_rules where action = 'allow' and dimension = 'app'",
    ).get().n)
  } catch { allowedApps = undefined }
  store.close()
} catch { observations = undefined }

// The collector is the thing that actually stores observations on this platform, so its state belongs in the
// verdict: measured 2026-10-06 on the owner's machine, it had been running for two hours with an empty store and a
// zero-byte WAL, which is what an untrusted collector looks like. Saying that here saves the next reader from
// having to find out that a running process and an empty table are both true at once.
const collector = (() => {
  const listing = spawnSync('ps', ['-eo', 'pid,etime,command'], { encoding: 'utf8' })
  if (listing.error) return { state: 'not verifiable here (no ps on this platform)' }
  const line = (listing.stdout ?? '').split('\n').find(l => l.includes('computer-history-collector') && !l.includes('grep'))
  if (!line) return { state: 'not running' }
  const trimmed = line.trim().split(/\s+/)
  return { state: 'running', pid: trimmed[0], uptime: trimmed[1], path: line.slice(line.indexOf('/')) }
})()

const step1 = pluginInstalled ? 'done' : 'not done'
// Three states, never a silent "done": an application that is not running has no running process to judge, and a
// profile with no manifest cannot have loaded anything. The first version defaulted both to 'done', which the edge
// runs caught: with no `.dsh` at all it reported step 2 as done.
const step2 = appStartedMs === undefined
  ? 'unknown (application not running)'
  : !pluginInstalled
    ? 'not done (the plugin is not installed)'
    : restartNeeded
      // Timestamps alone cannot settle this: a patch written seconds after the start may or may not have been
      // picked up, and the manifest that carries the plugin as a layer may have been written long before it.
      // Measured 2026-10-06: the running app did have the plugin active (the loader said so) while this line
      // still said "restart the application", because the patch was six seconds newer than the start.
      ? 'unknown (changed after startup - confirm via the panel, or the loader status)'
      : 'done'
const step3 = observations === undefined ? 'unreadable' : observations > 0 ? 'done' : 'not done'
const rows = [
  ['1. the plugin is installed as a layer', step1],
  ['2. the running application loaded it', step2],
  ['3. the store has its first observation', step3],
  ['4. the collector that stores them', collector.state === 'running' ? `running (pid ${collector.pid}, up ${collector.uptime})` : collector.state],
]

console.log('desktop-application path (the owner\'s baseline ①):')
for (const [name, value] of rows) console.log(`  ${value.padEnd(34)} ${name}`)
console.log(`\n  application started: ${appStartedMs ? new Date(appStartedMs).toISOString() : 'not running'}`)
console.log(`  manifest written:    ${manifestMs ? new Date(manifestMs).toISOString() : 'missing'}`)
console.log(`  patch written:       ${patchMs ? new Date(patchMs).toISOString() : 'missing'}`)

// Step three is the decisive one and it settles step two: a stored observation could only be there if the running
// application had loaded the plugin, whatever the timestamps say. Measured 2026-10-06 - the first observation
// arrived while this line still read "not judgeable", purely because the patch had been written after startup.
if (step3 === 'done' || (step1 === 'done' && step2 === 'done')) {
  console.log('\nverdict: the three steps have happened - the plugin is a layer, the application loaded it, and the')
  console.log('         store holds an observation. The count is 3 actions unless the owner reports extra ones; this')
  console.log('         command reads evidence, it does not count what a person did.')
  if (step2 !== 'done') console.log('         (step 2 is inferred from step 3: the timestamps alone could not settle it.)')
} else {
  console.log('\nverdict: not judgeable yet - the first step that is not done above is where it stands.')
  if (step3 !== 'done' && allowedApps === 0) {
    // The owner's actual machine, 2026-10-06. This is checkable from the store alone, so the command says it
    // before anything else and names the only action that changes it.
    console.log('\nno application is allowed yet, so nothing can be recorded however healthy the rest looks: the')
    console.log('policy is include-only and carries no allow rule. Allow one application in the panel (any app you')
    console.log('actually use, e.g. Terminal or Finder). This command reads the store directly, so it will say so.')
    console.log('(Measured: capture reported `running`, the collector was handshaken and trusted, refusedByReason was')
    console.log(' empty, and the store stayed at 0 - the empty allow list was the whole story.)')
  } else if (collector.state === 'running' && step3 !== 'done') {
    // Corrected 2026-10-06: this used to name the collector binary as the thing to enable. macOS attributes the
    // permission to the *application* (the system log says `responsible = com.deepseek.dsh`), and the collector
    // answers for itself when run directly, which is faster than reading the panel.
    console.log(`\nthe collector is up (pid ${collector.pid}) and the store is still empty. On macOS the remaining`)
    console.log('known cause is the accessibility permission, which macOS attributes to the application')
    console.log('(com.deepseek.dsh), not to the collector binary:')
    console.log('  System Settings -> Privacy & Security -> Accessibility, and enable DeepSeek Harness')
    console.log(`(the collector can be asked directly - run ${collector.path ?? 'the collector binary'} and it prints`)
    console.log(' {"type":"state","state":"running","accessibilityTrusted":...}.)')
  }
}
