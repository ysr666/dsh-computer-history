import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRebuildScheduler } from '../scripts/dev-client-watch.mjs'

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return
    // oxlint-disable-next-line eslint/no-await-in-loop -- Poll scheduler completion with bounded wait.
    await new Promise(done => setTimeout(done, 10))
  }
  assert.fail('build scheduler did not reach expected state')
}

test('bursty source events produce one serialized build', async () => {
  const finished = deferred()
  let started = 0
  const scheduler = createRebuildScheduler({
    debounceMs: 0,
    async run() { started++; finished.resolve() },
  })
  try {
    scheduler.request()
    scheduler.request()
    scheduler.request()
    await finished.promise
    assert.equal(started, 1)
  } finally { scheduler.close() }
})

test('changes during build trigger exactly one subsequent build without overlap', async () => {
  const gate = deferred()
  const secondFinished = deferred()
  let started = 0
  let simultaneous = 0
  let maximum = 0
  const scheduler = createRebuildScheduler({
    debounceMs: 0,
    async run() {
      started++
      simultaneous++
      maximum = Math.max(maximum, simultaneous)
      if (started === 1) await gate.promise
      simultaneous--
      if (started === 2) secondFinished.resolve()
    },
  })
  try {
    scheduler.request()
    await eventually(() => started === 1)
    scheduler.request()
    scheduler.request()
    await new Promise(done => setTimeout(done, 20))
    assert.equal(started, 1)
    gate.resolve()
    await secondFinished.promise
    assert.equal(started, 2)
    assert.equal(maximum, 1)
  } finally { gate.resolve(); scheduler.close() }
})

test('failure is reported and does not permanently stop the watcher', async () => {
  const recovered = deferred()
  let started = 0
  const errors: unknown[] = []
  const scheduler = createRebuildScheduler({
    debounceMs: 0,
    async run() {
      started++
      if (started === 1) throw new Error('compiler failed')
      recovered.resolve()
    },
    onError(error) { errors.push(error) },
  })
  try {
    scheduler.request()
    await eventually(() => errors.length === 1)
    scheduler.request()
    await recovered.promise
    assert.equal(started, 2)
    assert.match(String(errors[0]), /compiler failed/)
  } finally { scheduler.close() }
})
