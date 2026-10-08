#!/usr/bin/env node
// The scan that belongs before a release and nowhere else: is the repository in a state where cutting a version
// is honest?
//
//   pnpm verify:release:blockers
//
// It is deliberately two-tiered. Anything that is objectively bad - a failing run on `main`, an open high or
// critical security alert - fails the scan. Everything else (open pull requests and issues, branches that never
// landed, the previous release) is reported, because whether it blocks *this* release is a human judgement and a
// script that pretends otherwise just gets ignored.
import { spawnSync } from 'node:child_process'

const gh = (args) => {
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')}: ${(result.stderr ?? '').trim().split('\n')[0]}`)
  }
  return result.stdout
}
const json = (args) => {
  try {
    return JSON.parse(gh(args))
  } catch (error) {
    return { unavailable: String(error.message).split(':').slice(1).join(':').trim() }
  }
}

const problems = []
const notes = []

// 1. The commit we are about to release must be green. Historical failures on other commits — especially
// Dependabot's dynamic update checks — do not say anything about the release candidate and must not poison the
// gate forever. Read the current main head; allow an explicitly dispatched CI run for that
// exact SHA as well. Docs-only commits intentionally skip push CI, but manual CI must
// still run on the same commit and succeed before the Release gate can pass.
const mainBranch = json(['api', 'repos/{owner}/{repo}/branches/main'])
const mainSha = mainBranch?.commit?.sha
const runs = json(['run', 'list', '--branch', 'main', '--limit', '100', '--json', 'conclusion,event,headSha,name,status,workflowName'])
if (mainBranch.unavailable !== undefined) {
  problems.push(`could not read the main branch head: ${mainBranch.unavailable}`)
} else if (typeof mainSha !== 'string' || mainSha.length === 0) {
  problems.push('could not determine the current main commit')
} else if (runs.unavailable !== undefined) {
  problems.push(`could not read the runs on main: ${runs.unavailable}`)
} else {
  const current = runs.filter(run => run.headSha === mainSha && run.event === 'push')
  const ciRuns = runs.filter(run => run.headSha === mainSha
    && (run.workflowName === 'CI' || run.name === 'CI')
    && ['push', 'workflow_dispatch'].includes(run.event))
  // 'gh run list' is newest-first. The most recent exact-SHA CI attempt must
  // pass; an older success must not mask a subsequent failed or queued run.
  const ci = ciRuns[0]
  const incomplete = current.filter(run => !['success', 'skipped'].includes(run.conclusion ?? ''))

  if (current.length === 0) {
    problems.push(`current main ${mainSha.slice(0, 7)} has no push workflow result yet`)
  } else if (ci === undefined) {
    problems.push(`current main ${mainSha.slice(0, 7)} has no CI result: run CI manually on main after a docs-only commit`)
  } else if (ci.conclusion !== 'success') {
    problems.push(`current main ${mainSha.slice(0, 7)} CI is ${ci.status ?? ci.conclusion ?? 'not complete'}`)
  } else if (incomplete.length > 0) {
    problems.push(`current main ${mainSha.slice(0, 7)} is not fully green (${incomplete.map(run => `${run.workflowName ?? run.name}:${run.status ?? run.conclusion ?? 'pending'}`).join(', ')})`)
  } else {
    notes.push(`current main ${mainSha.slice(0, 7)} is green: ${current.length} push workflow(s) succeeded or skipped; exact-SHA CI passed via ${ci.event}`)
  }
}

// 2. Security alerts: an open high or critical one is a real reason to stop.
const alerts = json(['api', 'repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100'])
if (Array.isArray(alerts)) {
  const severe = alerts.filter(alert => ['high', 'critical'].includes(alert.security_advisory?.severity))
  if (severe.length > 0) {
    problems.push(`${severe.length} open high/critical dependabot alert(s): ${severe.map(alert => `${alert.dependency?.package?.name} ${alert.security_advisory?.severity}`).join(', ')}`)
  } else {
    notes.push(`dependabot: ${alerts.length} open alert(s), none high or critical`)
  }
} else {
  // Not "clean": unknown. A repository where this cannot be read is a repository where nobody checked.
  notes.push(`dependabot alerts could not be read (${alerts.unavailable ?? 'no data'}) - check by hand if this is the first release`)
}

// 3. Reported, not enforced: what is in flight and what never landed.
const pulls = json(['pr', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title'])
if (Array.isArray(pulls)) {
  notes.push(pulls.length === 0
    ? 'no open pull request'
    : `${pulls.length} open pull request(s): ${pulls.map(pull => `#${pull.number}`).join(', ')}`)
} else {
  notes.push(`open pull requests could not be read (${pulls.unavailable ?? 'no data'})`)
}

const issues = json(['issue', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title'])
if (Array.isArray(issues)) {
  notes.push(issues.length === 0
    ? 'no open issue'
    : `${issues.length} open issue(s): ${issues.map(issue => `#${issue.number}`).join(', ')}`)
} else {
  notes.push(`open issues could not be read (${issues.unavailable ?? 'no data'})`)
}

// A branch is "fresh" for a month. Older than that and nobody is coming back for it; it is either landed,
// abandoned, or forgotten, and all three are worth naming before a release rather than after.
const branches = json(['api', 'repos/{owner}/{repo}/branches?per_page=100'])
if (Array.isArray(branches)) {
  const fresh = branches.filter(branch => {
    const commit = json(['api', `repos/{owner}/{repo}/commits/${branch.name}`])
    if (commit.unavailable !== undefined) return false
    const when = Date.parse(commit.commit?.committer?.date ?? '')
    return Number.isFinite(when) && Date.now() - when < 30 * 24 * 60 * 60 * 1000
  })
  notes.push(`branches on the remote: ${branches.length} total, ${fresh.length} with a commit in the last month`)
} else {
  notes.push(`remote branches could not be read (${branches.unavailable ?? 'no data'})`)
}

for (const note of notes) console.log(`  ${note}`)
if (problems.length > 0) {
  console.error(`\nrelease blockers:\n${problems.map(problem => `  ${problem}`).join('\n')}`)
  process.exit(1)
}
console.log('\nno release blocker found')
