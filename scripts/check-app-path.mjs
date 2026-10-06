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
try {
  const store = new DatabaseSync(storePath, { readOnly: true })
  observations = Number(store.prepare('select count(*) as n from observations').get().n)
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

if (step1 === 'done' && step2 === 'done' && step3 === 'done') {
  console.log('\nverdict: the three steps have happened. The count is 3 actions unless the owner reports extra ones -')
  console.log('         this command reads evidence, it does not count what a person did.')
} else {
  console.log('\nverdict: not judgeable yet - the first step that is not done above is where it stands.')
  if (collector.state === 'running' && step3 !== 'done') {
    // On macOS the collector runs fine without the Accessibility permission and simply observes nothing, which is
    // the state this line was written from. Name the switch rather than leaving "it runs but does nothing" hanging.
    console.log(`\nthe collector is up (pid ${collector.pid}) and the store is still empty - on macOS that is what an`)
    console.log('untrusted collector looks like: System Settings -> Privacy & Security -> Accessibility, and enable')
    console.log(`  ${collector.path ?? 'the collector binary'}`)
  }
}
