/** Development-only staged tsdown build for DSH native Web HMR. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

async function filesUnder(root) {
  const files = []
  async function walk(dir) {
    for (const row of await readdir(dir, { withFileTypes: true })) {
      const absolute = join(dir, row.name)
      if (row.isDirectory()) await walk(absolute)
      else if (row.isFile()) files.push(relative(root, absolute))
      else throw new Error(`Unsupported output type: ${row.name}`)
    }
  }
  await walk(root)
  return files.sort()
}

async function atomicCopy(src, target) {
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.hmr-${process.pid}-${randomUUID()}`
  try { await copyFile(src, tmp); await rename(tmp, target) }
  finally { await rm(tmp, { force: true }) }
}

export async function publishVerifiedBuild(stage, destination, { afterFile } = {}) {
  const expected = await filesUnder(stage)
  if (!['index.js','index.d.ts','client.js','client.d.ts','build-info.json'].every(x => expected.includes(x))) {
    throw new Error('Incomplete staged Computer History build; live Client unchanged')
  }
  const client = await readFile(join(stage, 'client.js'), 'utf8')
  if (!client.includes('window.__ModuleLoader__.load(') ||
      !client.includes('id: "dsh-computer-history"')) {
    throw new Error('Staged DSH Client factory does not satisfy module loader contract')
  }
  for (const name of expected.filter(x => x !== 'client.js')) {
    await atomicCopy(join(stage, name), join(destination, name))
    await afterFile?.(name)
  }
  const current = await filesUnder(destination).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const keep = new Set(expected)
  for (const name of current) if (!keep.has(name)) await rm(join(destination, name), {force:true})
  await atomicCopy(join(stage, 'client.js'), join(destination, 'client.js'))
  await afterFile?.('client.js')
}

function runProcess(cmd, args, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const win = process.platform === 'win32'
    const command = win && cmd === 'pnpm' ? 'cmd.exe' : cmd
    const argv = win && cmd === 'pnpm' ? ['/d','/s','/c','pnpm',...args] : args
    const p = spawn(command, argv, { cwd: ROOT, stdio: 'inherit', env })
    p.once('error', rejectRun)
    p.once('close', (code, signal) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${cmd} exited ${signal ?? code}`)))
  })
}

export async function stagedBuild(root = ROOT, run = runProcess) {
  const stage = await mkdtemp(join(root, '.dch-hmr-stage-'))
  const env = { ...process.env, DCH_DEV_BUILD_OUT_DIR: stage }
  try {
    await run('pnpm', ['exec', 'tsdown'], env)
    await rename(join(stage, '.client-dts/client.d.ts'), join(stage, 'client.d.ts'))
    await rm(join(stage, '.client-dts'), { recursive: true, force: true })
    await run(process.execPath, ['scripts/write-build-info.mjs'], env)
    await publishVerifiedBuild(stage, join(root, 'lib'))
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stagedBuild()
}
