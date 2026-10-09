#!/usr/bin/env node
/* oxlint-disable no-await-in-loop -- product-journey polling is intentionally sequential */
/**
 * One real product journey against a throwaway DSH 0.2 Host.
 *
 *   DSH_CLI=/path/to/dsh pnpm e2e:product-journey
 *   DSH_PRODUCT_TARBALL=/path/to/assembled.tgz DSH_CLI=/path/to/dsh pnpm e2e:product-journey
 *
 * The only synthetic component is the protocol-only collector. It never reads
 * the desktop; it makes capture writable without OS Accessibility permission.
 * Everything above that boundary is real product code:
 *
 * install -> first-run consent -> editor pairing -> real Chrome extension
 * -> one workspace Episode -> Continue capsule/binding -> disable -> enable
 * -> uninstall while preserving history.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { initializeCdpSession } from './product-journey-cdp.mjs'
import { inspectFirstRunPolicy } from './product-journey-first-run.mjs'
import { DatabaseSync } from 'node:sqlite'

const REPO = path.resolve(import.meta.dirname, '..')
process.chdir(REPO)

const cli = process.env.DSH_CLI ?? 'dsh'
const suppliedProductTarball = process.env.DSH_PRODUCT_TARBALL
  ? path.resolve(process.env.DSH_PRODUCT_TARBALL)
  : undefined
const chromePath = process.env.PANEL_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const artifacts = path.join(
  REPO,
  '.debug',
  'e2e-product-journey',
  'run-' + stamp,
)
mkdirSync(artifacts, { recursive: true })

const checks = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function record(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + ': ' + detail)
}
function requireCheck(name, ok, detail) {
  record(name, ok, detail)
  if (!ok) throw new Error(name + ': ' + detail)
}
function run(command, args, options = {}) {
  // Never let a stalled installer, curl, or lifecycle command hold the release
  // runner indefinitely. An individual install is allowed extra time.
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120_000,
    ...options,
  })
  return {
    status: result.status ?? 1,
    out: String(result.stdout ?? '') + String(result.stderr ?? '')
      + (result.error ? '\n' + result.error.message : ''),
  }
}

function listenerPids(port) {
  const result = run('lsof', [
    '-nP',
    '-tiTCP:' + port,
    '-sTCP:LISTEN',
  ])
  if (result.status !== 0) return []
  return result.out
    .split('\n')
    .map(value => Number(value.trim()))
    .filter(value => Number.isInteger(value) && value > 1)
}

const versionResult = run(cli, ['--version'])
if (versionResult.status !== 0) {
  console.error(
    cli + ' is not runnable. Set DSH_CLI to a DeepSeek Harness 0.2 CLI.',
  )
  process.exit(2)
}
const dshVersion = versionResult.out.trim().split('\n')[0] ?? ''
if (!dshVersion.startsWith('0.2.')) {
  console.error(
    'product journey requires DSH 0.2.x; got ' + dshVersion
    + '. Do not run it against the old 0.1.x global CLI.',
  )
  process.exit(2)
}
if (!existsSync(chromePath)) {
  console.error(
    'no Chrome at ' + chromePath
    + ': install Google Chrome or set PANEL_CHROME',
  )
  process.exit(2)
}

if (process.platform === 'darwin') {
  const nativeArch = run('uname', ['-m']).out.trim()
  const chromeBinary = run('file', [chromePath])
  if (
    nativeArch === 'arm64'
    && chromeBinary.status === 0
    && !chromeBinary.out.includes('arm64')
  ) {
    console.error(
      'product journey requires an arm64/universal Chrome on Apple Silicon; '
      + 'got ' + chromeBinary.out.trim()
      + '. Use the mac-arm64 Chrome for Testing build.',
    )
    process.exit(2)
  }
}

console.log('product journey: DSH ' + dshVersion)

const home = mkdtempSync(path.join(os.tmpdir(), 'dsh-product-journey-'))
const runtimeHome = path.join(home, 'runtime-home')
const fakeBin = path.join(home, 'bin')
const profile = 'journey'
const webPort = 20020 + Math.floor(Math.random() * 120)
const companionPort = webPort + 1
const cdpPort = webPort + 1000
const dataDirectory = path.join(home, 'history')
const project = path.join(home, 'product-project')
const projectFile = path.join(project, 'src', 'app.ts')
const hostLog = path.join(artifacts, 'host.log')
const jar = path.join(artifacts, 'cookies.txt')
const fakeCodeMarker = path.join(home, 'fake-code-installed')
const collector = path.join(
  REPO,
  'scripts',
  'fixtures',
  'e2e-fake-collector.mjs',
)
const uiChromeProfile = path.join(home, 'ui-chrome')

function journeyOwnsPid(pid) {
  const command = run('ps', ['-p', String(pid), '-o', 'command='])
  if (command.status !== 0) return false
  const text = command.out.trim()
  return text.includes(home)
    || (
      text.includes('--profile ' + profile)
      && text.includes('--port ' + webPort)
    )
    || text.includes('--user-data-dir=' + uiChromeProfile)
}

async function stopOwnedListeners(ports) {
  for (const port of ports) {
    for (const pid of listenerPids(port)) {
      if (!journeyOwnsPid(pid)) {
        throw new Error(
          'port ' + port + ' is held by a process outside this product journey',
        )
      }
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }
  await sleep(500)
  for (const port of ports) {
    for (const pid of listenerPids(port)) {
      if (!journeyOwnsPid(pid)) continue
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
}

mkdirSync(runtimeHome, { recursive: true })
mkdirSync(fakeBin, { recursive: true })
mkdirSync(path.dirname(projectFile), { recursive: true })
writeFileSync(
  projectFile,
  'export function answer(): number {\n  return 42\n}\n',
)

const packagedEditorVersion = JSON.parse(
  readFileSync(path.join(REPO, 'extension-editor', 'package.json'), 'utf8'),
).version

const fakeCode = [
  '#!/bin/sh',
  'set -eu',
  'MARKER=' + JSON.stringify(fakeCodeMarker),
  'if [ "${1:-}" = "--list-extensions" ]; then',
  '  if [ -f "$MARKER" ]; then',
  "    printf '%s\\n' 'dsh-local.dsh-computer-history-editor@" + packagedEditorVersion + "'",
  '  fi',
  '  exit 0',
  'fi',
  'if [ "${1:-}" = "--install-extension" ]; then',
  '  : > "$MARKER"',
  '  exit 0',
  'fi',
  'exit 0',
].join('\n') + '\n'
const fakeCodePath = path.join(fakeBin, 'code')
writeFileSync(fakeCodePath, fakeCode)
chmodSync(fakeCodePath, 0o755)

const installEnv = {
  ...process.env,
  DSH_HOME: home,
}

function addBundle(spec) {
  let result = run(
    cli,
    ['plugin', '--profile', profile, 'add', spec],
    { env: installEnv, timeout: 180_000 },
  )
  if (result.status !== 0) {
    const workspace = path.join(
      home,
      'profiles',
      profile,
      'pnpm-workspace.yaml',
    )
    if (existsSync(workspace)) {
      writeFileSync(
        workspace,
        readFileSync(workspace, 'utf8')
          .replaceAll(': set this to true or false', ': false'),
      )
    }
    result = run(
      cli,
      ['plugin', '--profile', profile, 'add', spec],
      { env: installEnv, timeout: 180_000 },
    )
  }
  return result
}

let host
let chrome
let hostOutput = ''
let uiSession

function profileManifestPath() {
  return path.join(home, 'profiles', profile, 'package.json')
}

function writeHostLog() {
  writeFileSync(hostLog, hostOutput)
}

async function launchHost(environment) {
  hostOutput = ''
  host = spawn(
    cli,
    ['--profile', profile, '--port', String(webPort), '--no-open'],
    {
      env: environment,
      cwd: os.tmpdir(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  host.stdout.on('data', chunk => {
    hostOutput += String(chunk)
    writeHostLog()
  })
  host.stderr.on('data', chunk => {
    hostOutput += String(chunk)
    writeHostLog()
  })

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline && !/token=/.test(hostOutput)) {
    await sleep(500)
  }
  writeHostLog()
  const match = /dsh web:\s+(http:\/\/127\.0\.0\.1:[0-9]+\/\?token=([A-Za-z0-9_-]+))/u.exec(
    hostOutput,
  )
  return match?.[1]
}

async function stopHost() {
  const current = host
  if (current?.pid !== undefined) {
    try {
      process.kill(-current.pid, 'SIGTERM')
    } catch {
      try {
        current.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
    await Promise.race([
      new Promise(resolve => current.once('exit', resolve)),
      sleep(5_000),
    ])
  }
  host = undefined

  // The packaged DSH CLI can hand the web Host off to Electron. In that case
  // the wrapper exits but the listener survives outside its process group.
  // Only terminate listeners whose command line proves they belong to this
  // exact throwaway journey.
  await stopOwnedListeners([webPort, companionPort])
  await sleep(500)
}

function authApiPath(pathname) {
  return 'http://127.0.0.1:' + webPort + '/api/computer-history' + pathname
}

function apiRequest(method, pathname, body) {
  const args = [
    '-sS',
    '-b',
    jar,
    '-w',
    '\n%{http_code}',
    '-X',
    method,
    authApiPath(pathname),
  ]
  if (body !== undefined) {
    args.push(
      '-H',
      'content-type: application/json',
      '--data-binary',
      JSON.stringify(body),
    )
  }
  const result = run('curl', args)
  const split = result.out.lastIndexOf('\n')
  const text = split === -1 ? result.out : result.out.slice(0, split)
  const statusText = split === -1 ? '' : result.out.slice(split + 1).trim()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return {
    status: Number(statusText),
    text,
    json,
  }
}

async function waitForDebugger(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(
        'http://127.0.0.1:' + port + '/json/list',
        { signal: AbortSignal.timeout(3_000) },
      )
      if (response.ok) {
        const targets = await response.json()
        // A listening debugger can return an empty/temporary target list.
        // Require a registered page with a WebSocket URL before continuing.
        if (Array.isArray(targets) && targets.some(
          item => item.type === 'page' && item.webSocketDebuggerUrl,
        )) return targets
      }
    } catch {
      // browser not ready
    }
    if (chrome?.exitCode !== null && chrome?.exitCode !== undefined) {
      throw new Error('Chrome exited before exposing a page target (exit='
        + chrome.exitCode + ', signal=' + chrome.signalCode + ')')
    }
    await sleep(250)
  }
  throw new Error('Chrome DevTools page target never came up')
}

async function openUiSession() {
  // Retry only the initial Chrome page target and CDP connection. In
  // particular, Page.navigate and all subsequent UI assertions stay strict.
  const session = await initializeCdpSession(async () => {
    const targets = await (
      await fetch('http://127.0.0.1:' + cdpPort + '/json/list', {
        signal: AbortSignal.timeout(5_000),
      })
    ).json()
    const target = targets.find(item =>
      item.type === 'page' && item.webSocketDebuggerUrl)
    if (!target) throw new Error('Chrome has no CDP page target yet')
    return target.webSocketDebuggerUrl
  }, {
    onRetry(attempt, error) {
      console.log('  … Chrome CDP initialisation retry ' + attempt
        + '/4: ' + String(error?.message || error).slice(0, 180))
    },
  })
  session.evaluate = async expression => {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    return result.result?.value
  }
  session.shot = async name => {
    const result = await session.send('Page.captureScreenshot', {
      format: 'png',
    })
    writeFileSync(
      path.join(artifacts, name),
      Buffer.from(result.data, 'base64'),
    )
  }
  return session
}

// Opt-in visual evidence from the exact packaged Host/client, never from a
// mocked React tree. Media emulation is recorded separately from the Host's
// actual resolved colors: it is not proof of a theme switch by itself.
async function captureVisualMatrix(session, prefix) {
  if (process.env.DCH_VISUAL_MATRIX !== '1') return
  const measurements = []
  try {
    for (const colorScheme of ['light', 'dark']) {
      await session.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: colorScheme }],
      })
      for (const width of [1500, 960, 640, 420]) {
        await session.send('Emulation.setDeviceMetricsOverride', {
          width, height: 940, deviceScaleFactor: 1, mobile: false,
        })
        await sleep(450)
        const metrics = await session.evaluate(
          `(() => {
            const main=document.querySelector('.ch-main');
            if (!main) return { error: 'history panel not visible' };
            const box=main.getBoundingClientRect();
            const action=main.querySelector('.ch-first-run-action .ch-button');
            const actionBox=action?.getBoundingClientRect();
            const primary=main.querySelector('.ch-continue-primary');
            const button=primary?.getBoundingClientRect();
            const style=getComputedStyle(main);
            const token=getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim();
            return {
              viewport:innerWidth, mainWidth:Math.round(box.width),
              mainLeft:Math.round(box.left), mainRight:Math.round(box.right),
              documentOverflow:document.documentElement.scrollWidth-innerWidth,
              mainOverflow:main.scrollWidth-main.clientWidth,
              firstRunButtonOverflow:action?Number(action.scrollWidth>action.clientWidth+1):null,
              firstRunButtonWrapped:action?Number(action.scrollHeight>action.clientHeight+1):null,
              firstRunButtonWidth:actionBox?Math.round(actionBox.width):null,
              primaryButtonVisible:button?Boolean(button.width>40 && button.height>20):null,
              resolvedBackground:style.backgroundColor, resolvedForeground:style.color,
              hostBgToken:token,
              mediaDark:matchMedia('(prefers-color-scheme: dark)').matches,
              documentLang:document.documentElement.lang,
              hostTheme:document.documentElement.getAttribute('data-theme'),
              hostClass:document.documentElement.className,
            };
          })()`,
        )
        measurements.push({ colorScheme, width, ...metrics })
        await session.shot(`${prefix}-${colorScheme}-${width}.png`)
      }
    }
  } finally {
    // Restore the ordinary DSH viewport and browser color environment for all
    // existing behavioral checks that follow these optional captures.
    await session.send('Emulation.clearDeviceMetricsOverride')
    await session.send('Emulation.setEmulatedMedia', { features: [] })
  }
  writeFileSync(
    path.join(artifacts, `${prefix}-matrix.json`),
    JSON.stringify(measurements, null, 2) + '\n',
  )
  const unacceptable = measurements.filter(item =>
    item.error
      || item.documentOverflow > 1
      || item.mainOverflow > 1
      || item.firstRunButtonOverflow === 1
      || item.firstRunButtonWrapped === 1
      || item.primaryButtonVisible === false,
  )
  if (unacceptable.length > 0) {
    throw new Error('visual matrix layout failed: '
      + JSON.stringify(unacceptable.map(item => ({
        colorScheme: item.colorScheme,
        width: item.width,
        documentOverflow: item.documentOverflow,
        mainOverflow: item.mainOverflow,
        buttonOverflow: item.firstRunButtonOverflow,
      }))))
  }
  const light = measurements.find(item => item.colorScheme === 'light' && item.width === 420)
  const dark = measurements.find(item => item.colorScheme === 'dark' && item.width === 420)
  if (!light || !dark || light.resolvedForeground === dark.resolvedForeground) {
    throw new Error('visual matrix did not observe a real foreground color change')
  }
  if (process.env.DCH_VISUAL_LANG === 'en-US'
    && measurements.some(item => !item.documentLang?.startsWith('en'))) {
    throw new Error('requested English locale did not reach the real Host page')
  }
  console.log('  – visual matrix verified:', prefix,
    measurements.length, 'viewport/theme combinations (no clipping or overflow)')
}

// Run only against the throwaway E2E Host, never an actual user profile.
async function captureSettingsMatrix(session) {
  if (process.env.DCH_SETTINGS_MATRIX !== '1') return
  const clickSettings = await session.evaluate(
    "(() => { const items=[...document.querySelectorAll('button,a,[role=\"button\"]')].filter(x=>x.getClientRects().length && /^(Settings|设置)$/.test((x.textContent||'').trim())); const target=items.at(-1); if(!target)return {found:false};target.click();return {found:true,tag:target.tagName};})()",
  )
  await sleep(2200)
  const openedDialog = await session.evaluate(
    "(() => ({dialogCount:document.querySelectorAll('[role=\"dialog\"],dialog').length,matchingButtons:[...document.querySelectorAll('[role=\"dialog\"] button,[role=\"dialog\"] a')].filter(x=>/Computer History|电脑使用记录/.test((x.textContent||'').trim())).map(x=>(x.textContent||'').trim()).slice(0,6)}))()",
  )
  let settingsSeen=false
  for(const label of ['Computer History','电脑使用记录']){
    const prefix='(() => { const label='+JSON.stringify(label)+';'
    const rest='const root=document.querySelector(\'[role="dialog"]\')||document; const matches=[...root.querySelectorAll("*")].filter(x=>x.getClientRects().length&&(x.textContent||"").trim()===label);const last=matches.at(-1);if(!last)return false;const parent=last.closest(\'button,[role="tab"],[role="menuitem"],li,a,[data-slot]\');if(parent&&parent!==last)parent.click();else last.click();return true;})()'
    await session.evaluate(prefix+rest)
    await sleep(1400)
    settingsSeen=Number(await session.evaluate("document.querySelectorAll('.ch-settings-item').length"))>0
    if(settingsSeen)break
  }
  const state=await session.evaluate(
    "(() => ({rowCount:document.querySelectorAll('.ch-settings-item').length,modalCount:document.querySelectorAll('[role=\"dialog\"],dialog').length,rootPresent:Boolean(document.querySelector('.ch-settings-list')),width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth}))()",
  )
  console.log('  – settings visual probe', JSON.stringify({clickSettings,openedDialog,state}))
  await session.shot('settings-probe.png')
  if (!state.rootPresent || state.rowCount < 6) {
    throw new Error('cannot verify plugin settings: expected DCH rows are absent')
  }
  const matrix=[]
  try {
    for(const scheme of ['light','dark']){
      await session.send('Emulation.setEmulatedMedia', {
        features: [{name:'prefers-color-scheme',value:scheme}],
      })
      for(const width of [1500,960,640,420]){
        await session.send('Emulation.setDeviceMetricsOverride',{
          width,height:940,deviceScaleFactor:1,mobile:false,
        })
        await sleep(450)
        const m=await session.evaluate(
          "(() => {const list=document.querySelector('.ch-settings-list');const modal=document.querySelector('[role=\"dialog\"],dialog');if(!list||!modal)return {error:'settings not visible'};const r=list.getBoundingClientRect();const d=modal.getBoundingClientRect();return {lang:document.documentElement.lang,viewport:innerWidth,rows:list.querySelectorAll('.ch-settings-item').length,listWidth:Math.round(r.width),listOverflow:list.scrollWidth-list.clientWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,dialogOffscreen:Math.max(0,Math.round(-d.left),Math.round(d.right-innerWidth)),foreground:getComputedStyle(list).color,mediaDark:matchMedia('(prefers-color-scheme: dark)').matches}})()",
        )
        matrix.push({scheme,width,...m})
        await session.shot('settings-'+scheme+'-'+width+'.png')
      }
    }
  } finally {
    await session.send('Emulation.clearDeviceMetricsOverride')
    await session.send('Emulation.setEmulatedMedia',{features:[]})
  }
  writeFileSync(path.join(artifacts,'settings-matrix.json'),
    JSON.stringify(matrix,null,2)+'\n')
  // Input events, not manual DOM mutation: prove keyboard Tab reaches an
  // actionable element in the plugin's Settings section.
  const focusStops=[]
  for(let i=0;i<50;i++){
    await session.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9})
    await session.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9})
    const focus=await session.evaluate(
      "(() => {const el=document.activeElement;return {inside:Boolean(el?.closest('.ch-settings-item')),tag:el?.tagName??null,disabled:el?.disabled===true}})()",
    )
    if(focus.inside){focusStops.push({step:i+1,...focus});break}
  }
  writeFileSync(path.join(artifacts,'settings-focus.json'),
    JSON.stringify(focusStops,null,2)+'\n')
  const layoutFailures = matrix.filter(item =>
    item.error
      || item.rows < 6
      || item.documentOverflow > 1
      || item.listOverflow > 1
      || item.dialogOffscreen > 1,
  )
  if(layoutFailures.length>0){
    throw new Error('Settings matrix overflow/clipping: '
      + JSON.stringify(layoutFailures.map(item=>({
        scheme:item.scheme,width:item.width,listOverflow:item.listOverflow,
        documentOverflow:item.documentOverflow,dialogOffscreen:item.dialogOffscreen,
      }))))
  }
  const light = matrix.find(item => item.scheme === 'light' && item.width === 420)
  const dark = matrix.find(item => item.scheme === 'dark' && item.width === 420)
  if (!light || !dark || light.foreground === dark.foreground) {
    throw new Error('Settings matrix did not verify light/dark color resolution')
  }
  if (process.env.DCH_VISUAL_LANG === 'en-US'
    && matrix.some(item => !item.lang?.startsWith('en'))) {
    throw new Error('English Settings matrix was not rendered in English')
  }
  if (focusStops.length === 0) {
    throw new Error('Tab navigation did not reach any DCH Settings control')
  }
  console.log('  – settings matrix collected',matrix.length,
    'cases; keyboardFocusWithinDCH',focusStops.length>0)

}
async function probeSettingsReadError(session) {
  if (process.env.DCH_SETTINGS_ERROR !== '1') return
  await session.send('Network.enable')
  try {
    await session.send('Network.setBlockedURLs', { urls: ['*api/computer-history*'] })
    await session.send('Page.reload', { ignoreCache: true })
    await sleep(5000)
    await dismissDialogs(session)
    const opened=await openComputerHistory(session)
    await sleep(1000)
    const clicked=await session.evaluate(
      "(() => {const a=[...document.querySelectorAll('button,a,[role=\"button\"]')].filter(x=>x.getClientRects().length && /^(Settings|设置)$/.test((x.textContent||'').trim()));const n=a.at(-1);if(!n)return false;n.click();return true})()",
    )
    await sleep(1600)
    for(const label of ['Computer History','电脑使用记录']){
      const q='(() => {const label='+JSON.stringify(label)+';'
      const code='const root=document.querySelector(\'[role="dialog"]\')||document;const matches=[...root.querySelectorAll("*")].filter(x=>x.getClientRects().length&&(x.textContent||"").trim()===label);const last=matches.at(-1);if(!last)return false;const parent=last.closest(\'button,[role="tab"],[role="menuitem"],li,a,[data-slot]\');if(parent&&parent!==last)parent.click();else last.click();return true;})()'
      await session.evaluate(q+code)
      await sleep(1500)
      if(await session.evaluate("Boolean(document.querySelector('.ch-settings-state'))"))break
    }
    const result=await session.evaluate(
      "(() => ({errorPanel:Boolean(document.querySelector('.ch-settings-state[role=\"alert\"]')),retryButton:Boolean(document.querySelector('.ch-settings-state button')),settingsRows:document.querySelectorAll('.ch-settings-item').length,dialogCount:document.querySelectorAll('[role=\"dialog\"],dialog').length,language:document.documentElement.lang}))()",
    )
    await session.shot('settings-read-error.png')
    const errorMatrix=[]
    try {
      for(const scheme of ['light','dark']){
        await session.send('Emulation.setEmulatedMedia',{
          features:[{name:'prefers-color-scheme',value:scheme}],
        })
        for(const width of [1500,640,420]){
          await session.send('Emulation.setDeviceMetricsOverride',{
            width,height:940,deviceScaleFactor:1,mobile:false,
          })
          await sleep(350)
          const metrics=await session.evaluate(
            "(() => {const p=document.querySelector('.ch-settings-state[role=\"alert\"]');const b=p?.querySelector('button');if(!p||!b)return {error:'missing error panel or retry button'};const r=p.getBoundingClientRect();const z=b.getBoundingClientRect();return {lang:document.documentElement.lang,documentOverflow:document.documentElement.scrollWidth-innerWidth,panelOverflow:p.scrollWidth-p.clientWidth,panelLeft:r.left,panelRight:r.right,buttonWidth:z.width,buttonClipped:b.scrollWidth>b.clientWidth+1,foreground:getComputedStyle(p).color}})()",
          )
          errorMatrix.push({scheme,width,...metrics})
          await session.shot('settings-error-'+scheme+'-'+width+'.png')
        }
      }
    } finally {
      await session.send('Emulation.clearDeviceMetricsOverride')
      await session.send('Emulation.setEmulatedMedia',{features:[]})
    }
    writeFileSync(path.join(artifacts,'settings-error-matrix.json'),
      JSON.stringify(errorMatrix,null,2)+'\n')
    const errorFailures = errorMatrix.filter(item =>
      item.error
      || item.documentOverflow > 1
      || item.panelOverflow > 1
      || item.buttonWidth < 40
      || item.buttonClipped,
    )
    if (errorFailures.length > 0) {
      throw new Error('Settings read-error layout failed: '
        + JSON.stringify(errorFailures.map(item => ({
          scheme: item.scheme, width: item.width,
          panelOverflow: item.panelOverflow,
          documentOverflow: item.documentOverflow,
          error: item.error,
        }))))
    }
    const light = errorMatrix.find(item => item.scheme === 'light' && item.width === 420)
    const dark = errorMatrix.find(item => item.scheme === 'dark' && item.width === 420)
    if (!light || !dark || light.foreground === dark.foreground) {
      throw new Error('Settings error state did not verify dark/light foreground')
    }
    if (process.env.DCH_VISUAL_LANG === 'en-US'
      && errorMatrix.some(item => !item.lang?.startsWith('en'))) {
      throw new Error('Settings error view was not in English')
    }
    console.log('  – settings error matrix collected',errorMatrix.length)

    console.log('  – settings read-error probe',JSON.stringify({opened,clicked,result}))
    if(!result.errorPanel || !result.retryButton)throw new Error('Settings read-error view not shown')
  } finally {
    await session.send('Network.setBlockedURLs', { urls: [] })
    await session.send('Network.disable')
  }
}
async function dismissDialogs(session) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dismissed = await session.evaluate(
      "(() => {"
      + "const scope=document.querySelector('[role=\"dialog\"],dialog');"
      + "if(!scope)return false;"
      + "const buttons=[...scope.querySelectorAll('button')]"
      + ".filter(n=>n.getClientRects().length>0);"
      + "const hit=buttons.find(n=>/^(稍后|稍后配置|继续|知道了|关闭|Later|Configure later|Continue|Got it|Close|×)$/"
      + ".test((n.textContent||'').trim()))??buttons.at(-1);"
      + "if(!hit)return false;hit.click();return true;"
      + "})()",
    )
    if (!dismissed) break
    await sleep(500)
  }
}

async function openComputerHistory(session) {
  return session.evaluate(
    "(() => {"
    + "const nodes=[...document.querySelectorAll('button,[role=\"button\"],a,[data-slot]')]"
    + ".filter(n=>n.getClientRects().length>0);"
    + "const hit=nodes.filter(n=>/Computer History|电脑使用记录/.test("
    + "[n.textContent,n.getAttribute('aria-label'),n.getAttribute('title')]"
    + ".filter(Boolean).join(' ')))"
    + ".toSorted((a,b)=>(a.textContent||'').length-(b.textContent||'').length)[0];"
    + "if(!hit)return false;hit.click();return true;"
    + "})()",
  )
}

function historySnapshot() {
  const db = new DatabaseSync(path.join(dataDirectory, 'history.sqlite'))
  try {
    const episodes = db.prepare(
      'SELECT id, primary_workspace_root, primary_workspace_title '
      + 'FROM episodes ORDER BY ended_at_ms DESC',
    ).all()
    const episodeId = episodes[0]?.id
    const count = table => Number(
      db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count,
    )
    const links = episodeId === undefined
      ? 0
      : Number(db.prepare(
        'SELECT COUNT(*) AS count FROM episode_observations '
        + 'WHERE episode_id = ?',
      ).get(episodeId).count)
    const citations = episodeId === undefined
      ? 0
      : Number(db.prepare(
        'SELECT COUNT(*) AS count FROM episode_summary_citations '
        + 'WHERE episode_id = ?',
      ).get(episodeId).count)
    const bindings = db.prepare(
      'SELECT session_id, episode_id FROM continuation_sessions '
      + 'ORDER BY bound_at_ms',
    ).all()
    const resources = episodeId === undefined
      ? []
      : db.prepare(
        'SELECT r.canonical_uri AS uri '
        + 'FROM episode_resources er '
        + 'JOIN resources r ON r.id = er.resource_id '
        + 'WHERE er.episode_id = ? ORDER BY r.id',
      ).all().map(row => String(row.uri))
    return {
      observations: count('observations'),
      episodeCount: episodes.length,
      episodes,
      links,
      citations,
      bindings,
      resources,
    }
  } finally {
    db.close()
  }
}

function sameHistoryCounts(left, right) {
  return left.observations === right.observations
    && left.episodeCount === right.episodeCount
    && left.links === right.links
    && left.citations === right.citations
    && left.bindings.length === right.bindings.length
}

async function waitForHistory(
  predicate,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs
  let snapshot = historySnapshot()
  while (!predicate(snapshot) && Date.now() < deadline) {
    await sleep(100)
    snapshot = historySnapshot()
  }
  return snapshot
}

async function sendEditor(payload, token) {
  const response = await fetch(
    'http://127.0.0.1:' + companionPort + '/companion/observation',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': token,
      },
      body: JSON.stringify(payload),
    },
  )
  let body
  try {
    body = await response.json()
  } catch {
    body = { text: await response.text() }
  }
  return { status: response.status, body }
}

try {
  requireCheck(
    'protocol-only collector exists',
    existsSync(collector),
    path.relative(REPO, collector),
  )

  let tarball
  if (suppliedProductTarball) {
    tarball = suppliedProductTarball
    requireCheck(
      'pack release-shaped plugin',
      true,
      'reuse assembled release tarball',
    )
    requireCheck(
      'tarball exists',
      existsSync(tarball),
      path.basename(tarball),
    )
  } else {
    const packed = run(
      'pnpm',
      ['pack', '--pack-destination', home],
    )
    requireCheck(
      'pack release-shaped plugin',
      packed.status === 0,
      packed.status === 0 ? 'exit 0' : packed.out.trim().slice(-180),
    )
    const packageVersion = JSON.parse(
      readFileSync(path.join(REPO, 'package.json'), 'utf8'),
    ).version
    tarball = path.join(
      home,
      'dsh-computer-history-' + packageVersion + '.tgz',
    )
    requireCheck(
      'tarball exists',
      existsSync(tarball),
      path.basename(tarball),
    )
  }

  const webApp = addBundle('@deepseek-ai/dsh-web-app@0.2.0-rc.2')
  requireCheck(
    'install DSH web app',
    webApp.status === 0,
    webApp.status === 0 ? 'exit 0' : webApp.out.trim().slice(-180),
  )
  const plugin = addBundle(tarball)
  requireCheck(
    'install Computer History',
    plugin.status === 0,
    plugin.status === 0 ? 'exit 0' : plugin.out.trim().slice(-180),
  )

  const manifestPath = profileManifestPath()
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dependencies = Object.keys(manifest.dependencies ?? {})
  manifest.dsh = {
    ...manifest.dsh,
    profile: {
      ...manifest.dsh?.profile,
      bundles: [
        ...new Set([
          ...(manifest.dsh?.profile?.bundles ?? []),
          ...dependencies,
        ]),
      ],
    },
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  writeFileSync(
    path.join(home, 'profiles', profile, 'cordis.patch.yml'),
    [
      '- id: computer-history',
      '  config:',
      '    enabled: true',
      '    dataDirectory: ' + dataDirectory,
      '    collectorExecutable: ' + collector,
      '    autoResume: false',
      '    collectorRestart: false',
      '    captureLockProbeWaitMs: 250',
      '    companionPort: ' + companionPort,
      '',
    ].join('\n'),
  )

  const storePathResult = run('pnpm', ['store', 'path'])
  requireCheck(
    'resolve pnpm store for lifecycle uninstall',
    storePathResult.status === 0,
    storePathResult.status === 0
      ? storePathResult.out.trim()
      : storePathResult.out.trim().slice(-180),
  )
  const storePath = storePathResult.out.trim().split('\n').at(-1)
  const hostEnv = {
    ...installEnv,
    HOME: runtimeHome,
    PATH: fakeBin + ':' + String(process.env.PATH ?? ''),
    npm_config_store_dir: storePath,
    NPM_CONFIG_STORE_DIR: storePath,
  }

  let hostUrl = await launchHost(hostEnv)
  requireCheck(
    'Host starts',
    typeof hostUrl === 'string',
    hostUrl === undefined ? 'no token URL; see host.log' : 'port ' + webPort,
  )

  const auth = run(
    'curl',
    ['-sS', '-c', jar, '-o', '/dev/null', hostUrl],
  )
  requireCheck(
    'web session authenticates',
    auth.status === 0,
    auth.status === 0 ? 'cookie jar created' : auth.out.trim().slice(-160),
  )

  console.log('  … launching Chrome for Test (CDP port ' + cdpPort + ')')
  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--remote-debugging-port=' + cdpPort,
      '--user-data-dir=' + uiChromeProfile,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1500,1100',
      ...(process.env.DCH_VISUAL_LANG === 'en-US' ? ['--lang=en-US'] : []),
      'about:blank',
    ],
    {
      detached: true,
      stdio: 'ignore',
    },
  )
  chrome.on('exit', (code, signal) => {
    console.log('  … Chrome child exited (code=' + code
      + ', signal=' + signal + ')')
  })
  await waitForDebugger(cdpPort)
  record('Chrome DevTools endpoint responds', true, 'port ' + cdpPort)
  uiSession = await openUiSession()
  record('Chrome CDP session initialized', true, 'Page and Runtime enabled')
  if (process.env.DCH_VISUAL_LANG === 'en-US') {
    await uiSession.send('Emulation.setLocaleOverride', { locale: 'en-US' })
    await uiSession.send('Emulation.setUserAgentOverride', {
      userAgent: await uiSession.evaluate('navigator.userAgent'),
      acceptLanguage: 'en-US,en;q=0.9',
    })
  }
  console.log('  … Chrome navigating to authenticated DSH Host')
  await uiSession.send('Page.navigate', { url: hostUrl })
  record('Chrome navigates to the DSH Host', true, 'port ' + webPort)
  await sleep(7_000)
  await dismissDialogs(uiSession)

  const openedHistory = await openComputerHistory(uiSession)
  await sleep(1_500)
  requireCheck(
    'Computer History opens from DSH sidebar',
    openedHistory === true
      && await uiSession.evaluate(
        "Boolean(document.querySelector('.ch-main'))",
      ),
    String(openedHistory),
  )

  const firstRun = await uiSession.evaluate(
    "(() => {"
    + "const root=document.querySelector('.ch-first-run');"
    + "const button=root?.querySelector('.ch-continue-primary');"
    + "return {present:Boolean(root),button:Boolean(button),disabled:button?.disabled??null,text:(root?.innerText||'').slice(0,1400)};"
    + "})()",
  )
  await uiSession.shot('01-first-run.png')
  await captureVisualMatrix(uiSession, 'first-run')
  requireCheck(
    'first-run surface is shown',
    firstRun?.present === true && firstRun?.button === true,
    JSON.stringify(firstRun),
  )
  requireCheck(
    'first-run primary action is enabled',
    firstRun?.disabled === false,
    'disabled=' + String(firstRun?.disabled),
  )

  const firstRunClicked = await uiSession.evaluate(
    "(() => {"
    + "const button=document.querySelector('.ch-first-run .ch-continue-primary');"
    + "if(!button||button.disabled)return false;button.click();return true;"
    + "})()",
  )
  await sleep(2_500)
  requireCheck(
    'first-run consent action runs',
    firstRunClicked === true,
    String(firstRunClicked),
  )

  const stateAfterStart = apiRequest('GET', '/state')
  requireCheck(
    'capture becomes running',
    stateAfterStart.status === 200
      && stateAfterStart.json?.capture === 'running',
    'HTTP ' + stateAfterStart.status
      + ' capture=' + String(stateAfterStart.json?.capture),
  )
  const firstPolicy = apiRequest('GET', '/policy')
  const inventory = apiRequest('GET', '/system/applications')
  const firstRunAudit = inspectFirstRunPolicy({
    preset: stateAfterStart.json?.firstRunPreset,
    inventory: inventory.json,
    policy: firstPolicy.json,
  })
  requireCheck(
    'first-run defaults match installed apps and preserve Browser Companion',
    firstPolicy.status === 200
      && inventory.status === 200
      && firstRunAudit.ok,
    'revision=' + String(firstPolicy.json?.revision)
      + ' rules=' + String(firstPolicy.json?.rules?.length ?? 0)
      + ' inventory=' + String(firstRunAudit.inventoryAvailable)
      + ' expected=' + String(firstRunAudit.expectedCount ?? '?')
      + ' actual=' + String(firstRunAudit.actualCount ?? '?')
      + ' missing=' + JSON.stringify(firstRunAudit.missing ?? [])
      + ' unexpected=' + JSON.stringify(firstRunAudit.unexpected ?? []),
  )

  // The rest of the product journey sends synthetic Editor Companion activity
  // carrying the VS Code bundle ID. A hosted runner need not have VS Code
  // installed: after verifying the truthful first-run defaults, opt in this
  // fixture explicitly through the same authenticated Policy API a user uses.
  // Never change the shipped first-run preset or skip the privacy assertion.
  let journeyPolicy = firstPolicy
  const allowedApps = new Set(firstPolicy.json.rules
    .filter(rule => rule.dimension === 'app' && rule.action === 'allow')
    .map(rule => rule.pattern))
  if (!allowedApps.has('com.microsoft.VSCode')) {
    const now = Date.now()
    journeyPolicy = apiRequest('POST', '/policy', {
      mode: 'include-only',
      rules: [
        ...firstPolicy.json.rules.filter(rule => !rule.builtIn),
        {
          id: 'e2e:allow-vscode-fixture',
          dimension: 'app',
          action: 'allow',
          matcher: 'exact',
          pattern: 'com.microsoft.VSCode',
          builtIn: false,
          createdAtMs: now,
          updatedAtMs: now,
        },
      ],
    })
    requireCheck(
      'explicitly opt in synthetic VS Code fixture on runner without VS Code',
      journeyPolicy.status === 200
        && journeyPolicy.json?.rules?.some(rule =>
          rule.dimension === 'app'
          && rule.action === 'allow'
          && rule.pattern === 'com.microsoft.VSCode'),
      'HTTP ' + journeyPolicy.status,
    )
  }
  await uiSession.shot('02-recording.png')

  const browserPairing = apiRequest('POST', '/pairing/rotate')
  requireCheck(
    'Browser Companion token rotates',
    browserPairing.status === 200
      && typeof browserPairing.json?.token === 'string'
      && browserPairing.json.token.length >= 32,
    'HTTP ' + browserPairing.status,
  )

  const editorCapability = apiRequest('GET', '/companion/editor')
  requireCheck(
    'Editor Companion installer is available',
    editorCapability.status === 200
      && editorCapability.json?.available === true,
    JSON.stringify(editorCapability.json ?? {}),
  )
  const editorInstall = apiRequest('POST', '/companion/editor')
  requireCheck(
    'Editor Companion one-click install succeeds',
    editorInstall.status === 200
      && editorInstall.json?.status === 'installed'
      && editorInstall.json?.configured === true
      && existsSync(fakeCodeMarker),
    'HTTP ' + editorInstall.status
      + ' ' + JSON.stringify(editorInstall.json ?? {}),
  )

  const bootstrapPath = path.join(
    runtimeHome,
    '.dsh',
    'computer-history',
    'editor-companion-bootstrap.json',
  )
  let editorToken = ''
  for (let attempt = 0; attempt < 20 && editorToken === ''; attempt += 1) {
    try {
      const bootstrap = JSON.parse(readFileSync(bootstrapPath, 'utf8'))
      if (typeof bootstrap.token === 'string') editorToken = bootstrap.token
    } catch {
      // not staged yet
    }
    if (editorToken === '') await sleep(250)
  }
  requireCheck(
    'Editor Companion bootstrap is staged',
    editorToken.length >= 32,
    editorToken === '' ? 'bootstrap missing' : 'token length ' + editorToken.length,
  )
  rmSync(bootstrapPath, { force: true })
  requireCheck(
    'Editor Companion consumes bootstrap once',
    !existsSync(bootstrapPath),
    bootstrapPath,
  )

  const require = createRequire(import.meta.url)
  const editorPayload = require(
    path.join(REPO, 'extension-editor', 'out', 'payload.js'),
  )
  const identity = editorPayload.declaredIdentity('Visual Studio Code')
  const editorSession = 'product-journey-editor'
  const active = editorPayload.buildEditorPayload({
    metadata: {
      workspaceRoot: project,
      filePath: projectFile,
      languageId: 'typescript',
      surfaceKind: 'editor',
      title: 'app.ts',
    },
    identity,
    session: editorSession,
    seq: 1,
    observedAtMs: Date.now(),
  })
  const activeResult = await sendEditor(active, editorToken)
  requireCheck(
    'editor active observation is stored',
    activeResult.status === 201 && activeResult.body?.stored === true,
    'HTTP ' + activeResult.status + ' ' + JSON.stringify(activeResult.body),
  )

  const cookieLine = readFileSync(jar, 'utf8')
    .split('\n')
    .filter(line => line.includes('dsh-auth'))
    .map(line => {
      const fields = line.split('\t')
      return 'cookie=' + fields[5] + '=' + fields[6]
    })[0]
  const cookieFile = path.join(artifacts, 'cookie.txt')
  writeFileSync(cookieFile, String(cookieLine ?? '') + '\n')

  const browserMatrix = run(
    'node',
    [
      path.join(REPO, 'scripts', 'verify', 'chrome-companion.mjs'),
      '--token',
      browserPairing.json.token,
      '--db',
      path.join(dataDirectory, 'history.sqlite'),
      '--api',
      'http://127.0.0.1:' + webPort + '/api/computer-history',
      '--cookie',
      cookieFile,
      '--extension',
      path.join(REPO, 'dist', 'extension'),
      '--port',
      String(companionPort),
    ],
    {
      env: {
        ...process.env,
        PANEL_CHROME: chromePath,
      },
      timeout: 60_000,
    },
  )
  writeFileSync(path.join(artifacts, 'browser-matrix.log'), browserMatrix.out)
  // Emit only safe, actionable test results on failure. The raw subprocess
  // log can contain a pairing token and must never be uploaded or echoed.
  const browserMatrixSummary = browserMatrix.out.split('\n')
    .filter(line => /^(PASS  |FAIL  |matrix: |baseline companion rows|policy update: |extension id: |allowed control readiness: |the control cell failed:|control diagnostic:)/.test(line))
    .slice(-20)
    .join(' | ')
  requireCheck(
    'real Chrome Browser Companion privacy matrix passes',
    browserMatrix.status === 0,
    browserMatrix.status === 0
      ? 'Extensions.loadUnpacked + 7 privacy cells'
      : browserMatrixSummary || 'Browser Companion exited with status '
        + browserMatrix.status + '; see local diagnostic log',
  )

  const restoredPolicy = apiRequest(
    'POST',
    '/policy',
    {
      mode: journeyPolicy.json.mode,
      rules: journeyPolicy.json.rules,
    },
  )
  requireCheck(
    'first-run capture policy is restored after browser matrix',
    restoredPolicy.status === 200,
    'HTTP ' + restoredPolicy.status,
  )

  await sleep(150)
  const saved = editorPayload.buildEditorPayload({
    metadata: {
      workspaceRoot: project,
      filePath: projectFile,
      languageId: 'typescript',
      surfaceKind: 'editor',
      title: 'app.ts',
      event: 'save',
    },
    identity,
    session: editorSession,
    seq: 2,
    observedAtMs: Date.now(),
  })
  const savedResult = await sendEditor(saved, editorToken)
  requireCheck(
    'editor save observation is stored',
    savedResult.status === 201 && savedResult.body?.stored === true,
    'HTTP ' + savedResult.status + ' ' + JSON.stringify(savedResult.body),
  )

  await sleep(150)
  const verified = editorPayload.buildEditorPayload({
    metadata: {
      workspaceRoot: project,
      filePath: projectFile,
      languageId: 'typescript',
      surfaceKind: 'editor',
      title: 'app.ts',
      event: 'verify-test-success',
    },
    identity,
    session: editorSession,
    seq: 3,
    observedAtMs: Date.now(),
  })
  const verifiedResult = await sendEditor(verified, editorToken)
  requireCheck(
    'verification observation is stored',
    verifiedResult.status === 201
      && verifiedResult.body?.stored === true,
    'HTTP ' + verifiedResult.status
      + ' ' + JSON.stringify(verifiedResult.body),
  )

  const aggregate = await waitForHistory(snapshot =>
    snapshot.observations === 4
    && snapshot.episodeCount === 1
    && snapshot.links === 4
    && snapshot.citations === 4
    && snapshot.resources.length >= 2,
  )
  writeFileSync(
    path.join(artifacts, 'aggregate.json'),
    JSON.stringify(aggregate, null, 2) + '\n',
  )
  requireCheck(
    'short Browser detour stays inside one workspace Episode',
    aggregate.episodeCount === 1
      && aggregate.episodes[0]?.primary_workspace_root === project,
    JSON.stringify(aggregate.episodes),
  )
  requireCheck(
    'Episode keeps all four observation links',
    aggregate.observations === 4 && aggregate.links === 4,
    'observations=' + aggregate.observations + ' links=' + aggregate.links,
  )
  requireCheck(
    'Episode summary keeps all four citations',
    aggregate.citations === 4,
    'citations=' + aggregate.citations,
  )

  const liveRecent = apiRequest('GET', '/recent?limit=10')
  const liveEpisode = Array.isArray(liveRecent.json)
    ? liveRecent.json[0]
    : undefined
  const liveResourceUris = Array.isArray(liveEpisode?.resources)
    ? liveEpisode.resources
      .map(resource => resource?.canonicalUri)
      .filter(uri => typeof uri === 'string')
    : []
  writeFileSync(
    path.join(artifacts, 'live-recent.json'),
    JSON.stringify({
      status: liveRecent.status,
      episode: liveEpisode,
      externalSnapshot: aggregate,
    }, null, 2) + '\n',
  )
  requireCheck(
    'Host recent exposes the normalized Browser reference',
    liveRecent.status === 200
      && liveResourceUris.some(
        uri => uri.includes('/allowed/page')
          && !uri.includes('?')
          && !uri.includes('#'),
      ),
    'HTTP ' + liveRecent.status + ' ' + liveResourceUris.join(' '),
  )
  console.log(
    '  – live external SQLite resources (diagnostic only): '
    + (aggregate.resources.join(' ') || '(reader lagged behind Host connection)'),
  )

  await uiSession.send('Page.navigate', { url: hostUrl })
  await sleep(3_000)
  await dismissDialogs(uiSession)
  await openComputerHistory(uiSession)
  await sleep(1_500)
  const mainAfterWork = await uiSession.evaluate(
    "(() => {"
    + "const main=document.querySelector('.ch-main');"
    + "const button=main?.querySelector('.ch-continue-primary');"
    + "return {text:(main?.innerText||'').slice(0,3200),button:Boolean(button),disabled:button?.disabled??null};"
    + "})()",
  )
  await uiSession.shot('03-main-after-work.png')
  await captureVisualMatrix(uiSession, 'recent-work')
  await captureSettingsMatrix(uiSession)
  await probeSettingsReadError(uiSession)
  requireCheck(
    'Continue points at the project and app.ts',
    mainAfterWork?.button === true
      && mainAfterWork?.disabled === false
      && mainAfterWork.text.includes('product-project')
      && mainAfterWork.text.includes('app.ts'),
    JSON.stringify(mainAfterWork),
  )

  uiSession.ws.close()
  uiSession = undefined
  writeHostLog()
  const capsule = run(
    'node',
    [path.join(REPO, 'scripts', 'verify-continuation-capsule.mjs')],
    {
      env: {
        ...process.env,
        CAPSULE_HOST_LOG: hostLog,
        CAPSULE_CDP_PORT: String(cdpPort),
        CAPSULE_OUT: path.join(artifacts, 'continue'),
        CAPSULE_SEND: '0',
      },
      timeout: 60_000,
    },
  )
  writeFileSync(path.join(artifacts, 'continue.log'), capsule.out)
  requireCheck(
    'Continue creates the native Computer History capsule',
    capsule.status === 0
      && capsule.out.includes('CONTINUATION_CAPSULE_OK'),
    capsule.status === 0
      ? 'native @Computer History capsule'
      : capsule.out.trim().split('\n').slice(-5).join(' | '),
  )

  const afterContinue = historySnapshot()
  requireCheck(
    'Continue binds the new DSH Session to the exact Episode',
    afterContinue.bindings.length === 1
      && afterContinue.bindings[0]?.episode_id
        === afterContinue.episodes[0]?.id,
    JSON.stringify(afterContinue.bindings),
  )
  writeFileSync(
    path.join(artifacts, 'after-continue.json'),
    JSON.stringify(afterContinue, null, 2) + '\n',
  )

  uiSession = await openUiSession()
  await dismissDialogs(uiSession)
  const openedPlugins = await uiSession.evaluate(
    "(() => {"
    + "const nodes=[...document.querySelectorAll('button,[role=\"button\"],a')]"
    + ".filter(n=>n.getClientRects().length>0);"
    + "const hit=nodes.find(n=>/^(插件|Plugins)$/.test((n.textContent||n.getAttribute('aria-label')||'').trim()));"
    + "if(!hit)return false;hit.click();return true;"
    + "})()",
  )
  await sleep(1_500)
  requireCheck(
    'Plugins page opens',
    openedPlugins === true
      && await uiSession.evaluate(
        "Boolean(document.querySelector('[data-plugin-panel]'))",
      ),
    String(openedPlugins),
  )

  const openedDetail = await uiSession.evaluate(
    "(() => {"
    + "const card=document.querySelector('[data-plugin-package=\"dsh-computer-history\"]');"
    + "if(!card)return false;"
    + "const button=[...card.querySelectorAll('button')]"
    + ".find(n=>n.getAttribute('role')!=='switch');"
    + "if(!button)return false;button.click();return true;"
    + "})()",
  )
  await sleep(1_200)
  requireCheck(
    'Computer History plugin detail opens',
    openedDetail === true
      && await uiSession.evaluate(
        "Boolean(document.querySelector('[data-plugin-detail=\"dsh-computer-history\"]'))",
      ),
    String(openedDetail),
  )
  await uiSession.shot('04-plugin-detail.png')

  const historyBeforeLifecycle = historySnapshot()
  const disabled = await uiSession.evaluate(
    "(() => {"
    + "const detail=document.querySelector('[data-plugin-detail=\"dsh-computer-history\"]');"
    + "const button=detail?.querySelector('[role=\"switch\"]');"
    + "if(!button||button.getAttribute('aria-checked')!=='true')return false;"
    + "button.click();return true;"
    + "})()",
  )
  await sleep(3_000)
  const disabledState = apiRequest('GET', '/state')
  requireCheck(
    'disabling unloads Computer History routes',
    disabled === true && disabledState.status === 404,
    'clicked=' + String(disabled) + ' HTTP ' + disabledState.status,
  )
  const historyWhileDisabled = historySnapshot()
  requireCheck(
    'disabling preserves history',
    sameHistoryCounts(historyBeforeLifecycle, historyWhileDisabled),
    JSON.stringify(historyWhileDisabled),
  )
  await uiSession.shot('05-plugin-disabled.png')

  const reenabled = await uiSession.evaluate(
    "(() => {"
    + "const detail=document.querySelector('[data-plugin-detail=\"dsh-computer-history\"]');"
    + "const button=detail?.querySelector('[role=\"switch\"]');"
    + "if(!button||button.getAttribute('aria-checked')!=='false')return false;"
    + "button.click();return true;"
    + "})()",
  )
  await sleep(3_500)
  const reenabledState = apiRequest('GET', '/state')
  requireCheck(
    're-enabling restores a running Computer History Host',
    reenabled === true
      && reenabledState.status === 200
      && reenabledState.json?.capture === 'running'
      && reenabledState.json?.companion?.listening === true,
    'clicked=' + String(reenabled)
      + ' HTTP ' + reenabledState.status
      + ' capture=' + String(reenabledState.json?.capture),
  )
  const historyAfterReenable = historySnapshot()
  requireCheck(
    're-enabling preserves history and continuation binding',
    sameHistoryCounts(historyBeforeLifecycle, historyAfterReenable),
    JSON.stringify(historyAfterReenable),
  )
  await uiSession.shot('06-plugin-reenabled.png')

  // The main journey keeps HOME throwaway so Editor Companion bootstrap never
  // touches the user's real ~/.dsh. The packaged DSH app's pnpm, however,
  // resolves its content-addressed store from HOME. Restart only for the final
  // uninstall with the real OS home; no editor install runs after this point,
  // while DSH_HOME, profile and Computer History data all remain throwaway.
  uiSession.ws.close()
  uiSession = undefined
  await stopHost()
  const uninstallHostEnv = {
    ...installEnv,
    // The packaged DSH launcher executes its bundled pnpm through Electron's
    // Node mode. The CLI wrapper sets this for its own process, but it is not
    // inherited by this parent Node script, so make the package-manager
    // contract explicit for the lifecycle restart.
    ELECTRON_RUN_AS_NODE: '1',
    HOME: process.env.HOME ?? os.homedir(),
    PATH: fakeBin + ':' + String(process.env.PATH ?? ''),
  }
  hostUrl = await launchHost(uninstallHostEnv)
  requireCheck(
    'lifecycle Host restarts with package-manager HOME',
    typeof hostUrl === 'string',
    hostUrl === undefined ? 'no token URL; see host.log' : 'port ' + webPort,
  )
  const lifecycleAuth = run(
    'curl',
    ['-sS', '-c', jar, '-o', '/dev/null', hostUrl],
  )
  requireCheck(
    'lifecycle web session authenticates',
    lifecycleAuth.status === 0,
    lifecycleAuth.status === 0
      ? 'cookie jar refreshed'
      : lifecycleAuth.out.trim().slice(-160),
  )

  uiSession = await openUiSession()
  if (process.env.DCH_VISUAL_LANG === 'en-US') {
    await uiSession.send('Emulation.setLocaleOverride', { locale: 'en-US' })
    await uiSession.send('Emulation.setUserAgentOverride', {
      userAgent: await uiSession.evaluate('navigator.userAgent'),
      acceptLanguage: 'en-US,en;q=0.9',
    })
  }
  await uiSession.send('Page.navigate', { url: hostUrl })
  await sleep(7_000)
  await dismissDialogs(uiSession)
  const lifecyclePlugins = await uiSession.evaluate(
    "(() => {"
    + "const nodes=[...document.querySelectorAll('button,[role=\"button\"],a')]"
    + ".filter(n=>n.getClientRects().length>0);"
    + "const hit=nodes.find(n=>/^(插件|Plugins)$/.test((n.textContent||n.getAttribute('aria-label')||'').trim()));"
    + "if(!hit)return false;hit.click();return true;"
    + "})()",
  )
  await sleep(1_500)
  requireCheck(
    'Plugins page reopens for uninstall',
    lifecyclePlugins === true
      && await uiSession.evaluate(
        "Boolean(document.querySelector('[data-plugin-panel]'))",
      ),
    String(lifecyclePlugins),
  )
  const lifecycleDetail = await uiSession.evaluate(
    "(() => {"
    + "const card=document.querySelector('[data-plugin-package=\"dsh-computer-history\"]');"
    + "if(!card)return false;"
    + "const button=[...card.querySelectorAll('button')]"
    + ".find(n=>n.getAttribute('role')!=='switch');"
    + "if(!button)return false;button.click();return true;"
    + "})()",
  )
  await sleep(1_200)
  requireCheck(
    'Computer History detail reopens for uninstall',
    lifecycleDetail === true
      && await uiSession.evaluate(
        "Boolean(document.querySelector('[data-plugin-detail=\"dsh-computer-history\"]'))",
      ),
    String(lifecycleDetail),
  )

  const uninstallOpened = await uiSession.evaluate(
    "(() => {"
    + "const detail=document.querySelector('[data-plugin-detail=\"dsh-computer-history\"]');"
    + "const button=[...detail.querySelectorAll('button')]"
    + ".find(n=>/卸载|Uninstall/.test((n.getAttribute('aria-label')||n.textContent||'').trim()));"
    + "if(!button)return false;button.click();return true;"
    + "})()",
  )
  await sleep(500)
  const uninstallConfirmed = await uiSession.evaluate(
    "(() => {"
    + "const dialog=document.querySelector('[role=\"dialog\"],dialog');"
    + "if(!dialog)return false;"
    + "const buttons=[...dialog.querySelectorAll('button')]"
    + ".filter(n=>n.getClientRects().length>0);"
    + "const button=buttons.find(n=>/^(卸载|Uninstall)$/.test((n.textContent||'').trim()));"
    + "if(!button)return false;button.click();return true;"
    + "})()",
  )
  requireCheck(
    'uninstall confirmation runs',
    uninstallOpened === true && uninstallConfirmed === true,
    'opened=' + String(uninstallOpened)
      + ' confirmed=' + String(uninstallConfirmed),
  )

  const readPackageGone = () => {
    const currentManifest = JSON.parse(
      readFileSync(profileManifestPath(), 'utf8'),
    )
    const dependencyGone =
      currentManifest.dependencies?.['dsh-computer-history'] === undefined
    const bundleGone = !(currentManifest.dsh?.profile?.bundles ?? [])
      .includes('dsh-computer-history')
    const nodeModulesGone = !existsSync(
      path.join(
        home,
        'profiles',
        profile,
        'node_modules',
        'dsh-computer-history',
      ),
    )
    return {
      dependencyGone,
      bundleGone,
      nodeModulesGone,
      gone: dependencyGone && bundleGone && nodeModulesGone,
    }
  }

  const uiUninstallDeadline = Date.now() + 10_000
  let packageState = readPackageGone()
  while (!packageState.bundleGone && Date.now() < uiUninstallDeadline) {
    await sleep(250)
    packageState = readPackageGone()
  }
  let afterUninstallState = apiRequest('GET', '/state')
  requireCheck(
    'uninstall UI deselects the bundle',
    packageState.bundleGone,
    JSON.stringify(packageState)
      + ' HTTP ' + afterUninstallState.status,
  )

  // Desktop/HMR Hosts unload the bundle immediately. A plain web-profile Host
  // applies the same profile selection on its next boot, so verify that path by
  // restarting before judging route removal.
  if (afterUninstallState.status !== 404) {
    record(
      'web Host applies bundle deselection on restart',
      true,
      'live route stayed HTTP ' + afterUninstallState.status,
    )
    try {
      uiSession?.ws.close()
    } catch {
      // already closed
    }
    uiSession = undefined
    await stopHost()
    hostUrl = await launchHost(uninstallHostEnv)
    requireCheck(
      'Host restarts after bundle deselection',
      typeof hostUrl === 'string',
      hostUrl === undefined ? 'no token URL; see host.log' : 'port ' + webPort,
    )
    const postDeselectAuth = run(
      'curl',
      ['-sS', '-c', jar, '-o', '/dev/null', hostUrl],
    )
    requireCheck(
      'post-deselect web session authenticates',
      postDeselectAuth.status === 0,
      postDeselectAuth.status === 0
        ? 'cookie jar refreshed'
        : postDeselectAuth.out.trim().slice(-160),
    )
    afterUninstallState = apiRequest('GET', '/state')
  }
  requireCheck(
    'deselected bundle no longer exposes Computer History routes',
    afterUninstallState.status === 404,
    'HTTP ' + afterUninstallState.status,
  )

  // Stop the Host before mutating node_modules. This mirrors package-manager
  // ownership in the Desktop shell and avoids changing a live dependency tree.
  if (uiSession !== undefined) {
    await uiSession.shot('07-after-uninstall.png')
    uiSession.ws.close()
    uiSession = undefined
  }
  await stopHost()

  // A web-profile Host intentionally does not have the Desktop shell's
  // launcher-owned packageManager invocation. The UI owns deselection/unload;
  // the DSH CLI owns package removal in this harness. On a Desktop Host the UI
  // may already have removed the dependency, in which case this is a no-op.
  if (!packageState.dependencyGone || !packageState.nodeModulesGone) {
    const removed = run(
      cli,
      ['plugin', '--profile', profile, 'remove', 'dsh-computer-history'],
      {
        env: {
          ...installEnv,
          HOME: process.env.HOME ?? os.homedir(),
        },
      },
    )
    writeFileSync(
      path.join(artifacts, 'package-remove.log'),
      removed.out,
    )
    requireCheck(
      'DSH CLI package lifecycle removes Computer History',
      removed.status === 0,
      removed.status === 0
        ? 'exit 0'
        : removed.out.trim().split('\n').slice(-5).join(' | '),
    )
  } else {
    record(
      'DSH CLI package lifecycle removes Computer History',
      true,
      'Desktop/UI package-manager path already removed it',
    )
  }

  const packageDeadline = Date.now() + 10_000
  packageState = readPackageGone()
  while (!packageState.gone && Date.now() < packageDeadline) {
    await sleep(250)
    packageState = readPackageGone()
  }
  requireCheck(
    'package dependency, bundle selection, and node_modules are gone',
    packageState.gone,
    JSON.stringify(packageState),
  )

  const historyAfterUninstall = historySnapshot()
  requireCheck(
    'uninstall preserves Computer History data',
    sameHistoryCounts(historyBeforeLifecycle, historyAfterUninstall),
    JSON.stringify(historyAfterUninstall),
  )
  requireCheck(
    'final preserved history is 4 observations / 1 Episode / 4 citations / 1 binding',
    historyAfterUninstall.observations === 4
      && historyAfterUninstall.episodeCount === 1
      && historyAfterUninstall.links === 4
      && historyAfterUninstall.citations === 4
      && historyAfterUninstall.bindings.length === 1,
    JSON.stringify(historyAfterUninstall),
  )
} catch (error) {
  record(
    'journey',
    false,
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
} finally {
  try {
    uiSession?.ws.close()
  } catch {
    // already closed
  }
  if (chrome?.pid !== undefined) {
    try {
      process.kill(-chrome.pid, 'SIGTERM')
    } catch {
      try {
        chrome.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
  }
  await sleep(500)
  try {
    await stopHost()
    await stopOwnedListeners([cdpPort])
    record(
      'product journey cleans up its Host and Chrome listeners',
      listenerPids(webPort).length === 0
        && listenerPids(companionPort).length === 0
        && listenerPids(cdpPort).length === 0,
      'ports ' + [webPort, companionPort, cdpPort].join(', '),
    )
  } catch (error) {
    record(
      'product journey cleans up its Host and Chrome listeners',
      false,
      error instanceof Error ? error.message : String(error),
    )
    process.exitCode = 1
  }
  writeHostLog()
  writeFileSync(
    path.join(artifacts, 'checks.json'),
    JSON.stringify(checks, null, 2) + '\n',
  )
  if (process.env.DSH_E2E_KEEP === '1') {
    console.log('  kept throwaway home: ' + home)
  } else {
    rmSync(home, { recursive: true, force: true })
  }
}

const failed = checks.filter(check => !check.ok)
console.log('\nartifacts: ' + path.relative(REPO, artifacts))
if (failed.length > 0) {
  console.error(
    'product journey failed: '
    + failed.map(item => item.name + ' (' + item.detail + ')').join('; '),
  )
  process.exit(1)
}
console.log(
  'product journey passed: '
  + checks.length
  + ' checks across install, first-run, Browser/Editor, Episode, Continue, and plugin lifecycle',
)
