#!/usr/bin/env node
/**
 * Protocol-only collector for end-to-end product tests.
 *
 * It never reads the desktop. It only proves the Host/companion/product
 * plumbing while reporting a healthy collector lifecycle:
 *
 *   hello -> configure -> configured + running
 *   pause -> paused
 *   resume -> running
 *   shutdown -> exit 0
 *
 * Real accessibility/UIA/AT-SPI capture remains covered by the native
 * collectors and their platform validation; this fixture must never be
 * shipped in the plugin package.
 */
import readline from 'node:readline'

const session = `e2e-collector-${process.pid}`

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function state(value) {
  send({
    v: 1,
    type: 'state',
    state: value,
    accessibilityTrusted: true,
  })
}

send({
  v: 1,
  type: 'hello',
  collectorSession: session,
  collectorVersion: 'e2e-protocol-only',
  platform: process.platform,
  arch: process.arch === 'x64' ? 'x64' : 'arm64',
  capabilities: [
    'app-focus',
    'window-metadata',
    'resource-uri',
    'secure-field-detection',
  ],
})

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

input.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message?.type === 'configure') {
    send({
      v: 1,
      type: 'configured',
      revision: message.revision,
    })
    state('running')
    return
  }

  if (message?.type === 'pause') {
    state('paused')
    return
  }

  if (message?.type === 'resume') {
    state('running')
    return
  }

  if (message?.type === 'shutdown') {
    process.exit(0)
  }
})
