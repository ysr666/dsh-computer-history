#!/usr/bin/env node
/**
 * Read-only local upgrade PREflight.
 * Does not open the SQLite database, copy files, kill processes, or install a plugin.
 */
import { homedir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { inspectUpgradeEnvironment } from './upgrade-preflight-core.mjs'

function argValue(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new Error('missing value for ' + name)
  }
  return value
}

const args = process.argv.slice(2)
if (args.includes('--help')) {
  process.stdout.write([
    'Read-only Computer History upgrade readiness inspection.',
    'Usage: node scripts/preflight-local-upgrade.mjs [--profile desktop] [--dsh-home /absolute/path] [--json]',
    'No backup, DB reads/writes, plugin install, process stop, or upgrade is performed.',
  ].join('\n') + '\n')
  process.exit(0)
}
try {
  for (const arg of args) {
    if (arg.startsWith('--') && ![
      '--profile', '--dsh-home', '--json',
    ].includes(arg)) throw new Error('unknown flag: ' + arg)
  }
  const cli = spawnSync('dsh', ['--version'], {
    encoding: 'utf8', timeout: 3_000, env: process.env,
  })
  const detectedVersion = cli.status === 0 ? cli.stdout.trim() : null
  const report = inspectUpgradeEnvironment({
    dshHome: path.resolve(argValue(args, '--dsh-home')
      ?? path.join(homedir(), '.dsh')),
    profile: argValue(args, '--profile') ?? 'desktop',
    dshVersion: detectedVersion,
  })
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    console.log('Computer History upgrade PREflight — READ ONLY')
    console.log('Profile: ' + report.profile)
    console.log('DSH: ' + (report.cli.version ?? 'unknown')
      + ' (' + report.cli.compatibility + ')')
    console.log('Plugin: ' + (report.plugin.installedVersion ?? 'not installed')
      + ' (' + report.plugin.dependencyKind + ')')
    console.log('Database / WAL / SHM: '
      + [report.historyFiles.database, report.historyFiles.writeAheadLog,
        report.historyFiles.sharedMemory].map(f => f.present ? 'present' : 'absent').join(' / '))
    console.log('Release authorization: NOT GRANTED (this is inventory only)')
    for (const issue of report.blockers) console.log('BLOCKER: ' + issue)
    for (const issue of report.cautions) console.log('CAUTION: ' + issue)
    console.log('Safe next steps:')
    for (const line of report.nextSteps) console.log('  - ' + line)
  }
  process.exitCode = report.blockers.length ? 2 : 0
} catch (error) {
  console.error('Upgrade preflight could not run: ' + error.message)
  process.exitCode = 1
}
