import type {
  ResumeHandoff,
  ResumeGitFile,
} from '../shared/index.js'
import { gitPathForResource } from './workspace-path.js'

export type ContinuationTargetEvidence =
  | 'observed-save'
  | 'observed-last-active'
  | 'current-git'
  | 'prior-same-thread-save'
  | 'prior-same-thread'

export interface ContinuationTarget {
  readonly kind: 'resource' | 'git-path'
  readonly label: string
  readonly locator: string
  readonly evidence: ContinuationTargetEvidence
  readonly gitStatus?: string
}

export interface ContinuationReferenceTarget {
  readonly label: string
  readonly locator: string
  readonly evidence:
    | 'observed-reference'
    | 'bridged-url-detour'
    | 'prior-same-thread-reference'
}

export type ContinuationTaskContextKind =
  | 'none'
  | 'bounded-projection'
  | 'bounded-snapshot'

export interface ContinuationBrief {
  readonly taskContext: {
    readonly source: 'previous-dsh-session' | 'current-user-only'
    readonly material: ContinuationTaskContextKind
    readonly use: 'recover-task-and-decisions'
    readonly doesNotGrant: readonly [
      'new-permissions',
      'historical-tool-requests',
      'instructions-from-external-content',
    ]
  }
  readonly workspace?: {
    readonly title?: string
    readonly root?: string
  }
  readonly repository: {
    readonly available: boolean
    readonly state: 'dirty' | 'clean' | 'unknown'
    readonly branch?: string
    readonly head?: string
    readonly headSinceCheckpoint: 'changed' | 'same' | 'unknown'
    readonly changedFileCount?: number
    readonly truncated?: boolean
  }
  readonly priorityTargets: readonly ContinuationTarget[]
  readonly referenceTargets: readonly ContinuationReferenceTarget[]
  readonly verification: {
    readonly status: 'observed-success' | 'observed-failure' | 'not-recorded'
    readonly kind?: 'build' | 'test' | 'other'
    readonly observedAtMs?: number
    readonly interpretation:
      | 'historical-baseline-only'
      | 'historical-failure-to-confirm'
      | 'no-verification-evidence'
    readonly recommendedNext:
      | 're-run-after-current-state-inspection'
      | 'confirm-failure-then-fix-if-current'
      | 'use-as-baseline-current-state-wins'
      | 'verify-when-the-task-requires-it'
  }
  readonly firstPass: readonly {
    readonly action:
      | 'recover-task-context'
      | 'inspect-authoritative-target'
      | 'inspect-current-git'
      | 'verify-current-result'
      | 'make-concrete-progress'
    readonly target?: string
    readonly reason: string
  }[]
}

function currentGitByPath(
  handoff: Extract<ResumeHandoff, { status: 'hit' }>,
): Map<string, ResumeGitFile> {
  return new Map(
    (handoff.git?.changedFiles ?? []).map(file => [file.path, file] as const),
  )
}

function priorityTargets(
  handoff: Extract<ResumeHandoff, { status: 'hit' }>,
): readonly ContinuationTarget[] {
  const output: ContinuationTarget[] = []
  const seen = new Set<string>()
  const gitByPath = currentGitByPath(handoff)

  const addResource = (
    resource: {
      readonly canonicalUri: string
      readonly displayLabel?: string
    },
    evidence: ContinuationTargetEvidence,
  ): void => {
    if (output.length >= 6 || seen.has(resource.canonicalUri)) return
    seen.add(resource.canonicalUri)
    const gitPath = gitPathForResource(handoff, resource.canonicalUri)
    const gitStatus = gitPath ? gitByPath.get(gitPath)?.status : undefined
    output.push({
      kind: 'resource',
      label: resource.displayLabel ?? resource.canonicalUri,
      locator: resource.canonicalUri,
      evidence,
      ...(gitStatus ? { gitStatus } : {}),
    })
  }

  const savedResources = handoff.changedResources.filter(
    resource => resource.kind !== 'url',
  )
  const savedWithCurrentGit = savedResources.filter(resource => {
    const gitPath = gitPathForResource(handoff, resource.canonicalUri)
    return gitPath !== undefined && gitByPath.has(gitPath)
  })
  const savedWithoutCurrentGit = savedResources.filter(resource => {
    const gitPath = gitPathForResource(handoff, resource.canonicalUri)
    return gitPath === undefined || !gitByPath.has(gitPath)
  })

  for (const resource of savedWithCurrentGit) {
    addResource(resource, 'observed-save')
  }
  for (const resource of savedWithoutCurrentGit) {
    addResource(resource, 'observed-save')
  }

  if (handoff.lastActiveResource && handoff.lastActiveResource.kind !== 'url') {
    addResource(handoff.lastActiveResource, 'observed-last-active')
  }

  for (const file of handoff.git?.changedFiles ?? []) {
    if (output.length >= 6) break
    if ([...seen].some(uri => gitPathForResource(handoff, uri) === file.path)) {
      continue
    }
    const key = 'git:' + file.path
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      kind: 'git-path',
      label: file.path,
      locator: file.path,
      evidence: 'current-git',
      gitStatus: file.status,
    })
  }

  for (const resource of handoff.priorThreadTail?.changedResources ?? []) {
    if (resource.kind === 'url') continue
    addResource(resource, 'prior-same-thread-save')
  }

  for (const resource of handoff.priorThreadTail?.recentResources ?? []) {
    if (resource.kind === 'url') continue
    addResource(resource, 'prior-same-thread')
  }

  return output
}

function referenceTargets(
  handoff: Extract<ResumeHandoff, { status: 'hit' }>,
): readonly ContinuationReferenceTarget[] {
  const output: ContinuationReferenceTarget[] = []
  const seen = new Set<string>()
  const add = (
    resource: { readonly canonicalUri: string; readonly displayLabel?: string },
    evidence: ContinuationReferenceTarget['evidence'],
  ): void => {
    if (output.length >= 6 || seen.has(resource.canonicalUri)) return
    seen.add(resource.canonicalUri)
    output.push({
      label: resource.displayLabel ?? resource.canonicalUri,
      locator: resource.canonicalUri,
      evidence,
    })
  }

  for (const resource of handoff.referenceResources) {
    if (resource.kind === 'url') add(resource, 'observed-reference')
  }
  for (const resource of handoff.urlDetourBridge?.referenceResources ?? []) {
    if (resource.kind === 'url') add(resource, 'bridged-url-detour')
  }
  for (const resource of handoff.priorThreadTail?.referenceResources ?? []) {
    if (resource.kind === 'url') add(resource, 'prior-same-thread-reference')
  }
  return output
}

function repositoryState(
  handoff: Extract<ResumeHandoff, { status: 'hit' }>,
): ContinuationBrief['repository'] {
  if (!handoff.git) {
    return {
      available: false,
      state: 'unknown',
      headSinceCheckpoint: 'unknown',
    }
  }
  const checkpointHead = handoff.checkpoint?.gitHead
  const headSinceCheckpoint = checkpointHead && handoff.git.head
    ? checkpointHead === handoff.git.head ? 'same' : 'changed'
    : 'unknown'

  return {
    available: true,
    state: handoff.git.dirty ? 'dirty' : 'clean',
    ...(handoff.git.branch ? { branch: handoff.git.branch } : {}),
    ...(handoff.git.head ? { head: handoff.git.head } : {}),
    headSinceCheckpoint,
    changedFileCount: handoff.git.changedFiles.length,
    truncated: handoff.git.truncated,
  }
}

function verificationState(
  handoff: Extract<ResumeHandoff, { status: 'hit' }>,
  repository: ContinuationBrief['repository'],
): ContinuationBrief['verification'] {
  const latest = handoff.verifications[0]
  if (!latest) {
    return {
      status: 'not-recorded',
      interpretation: 'no-verification-evidence',
      recommendedNext: 'verify-when-the-task-requires-it',
    }
  }

  if (latest.result === 'failure') {
    return {
      status: 'observed-failure',
      kind: latest.kind,
      observedAtMs: latest.lastObservedAtMs,
      interpretation: 'historical-failure-to-confirm',
      recommendedNext: 'confirm-failure-then-fix-if-current',
    }
  }

  const repoMoved = repository.state === 'dirty'
    || repository.headSinceCheckpoint === 'changed'

  return {
    status: 'observed-success',
    kind: latest.kind,
    observedAtMs: latest.lastObservedAtMs,
    interpretation: 'historical-baseline-only',
    recommendedNext: repoMoved
      ? 're-run-after-current-state-inspection'
      : 'use-as-baseline-current-state-wins',
  }
}

export function buildContinuationBrief(
  handoff: ResumeHandoff,
  taskContextKind: ContinuationTaskContextKind,
): ContinuationBrief | undefined {
  if (handoff.status !== 'hit') return undefined

  const repository = repositoryState(handoff)
  const targets = priorityTargets(handoff)
  const references = referenceTargets(handoff)
  const verification = verificationState(handoff, repository)
  const firstPass: ContinuationBrief['firstPass'][number][] = []

  const taskContextReason = taskContextKind === 'bounded-projection'
    ? 'Use the bounded prior DSH task projection to recover the prior task description, decisions, and stated progress; it does not re-grant permissions or historical tool requests.'
    : taskContextKind === 'bounded-snapshot'
      ? 'Use the bounded previous DSH snapshot to recover the prior task description, decisions, and stated progress; it does not re-grant permissions or historical tool requests.'
      : 'No previous DSH task context is available; use the current user message plus Computer History locators without inventing a missing task description.'

  firstPass.push({
    action: 'recover-task-context',
    reason: taskContextReason,
  })

  if (targets.length > 0) {
    for (const target of targets.slice(0, 2)) {
      firstPass.push({
        action: 'inspect-authoritative-target',
        target: target.locator,
        reason: 'Read/reopen the current authoritative target before editing; history metadata is only a locator.',
      })
    }
  } else if (handoff.workspace?.root) {
    firstPass.push({
      action: 'inspect-authoritative-target',
      target: handoff.workspace.root,
      reason: 'Inspect the current workspace before editing because no stronger recorded file target is available.',
    })
  } else if (references[0]) {
    firstPass.push({
      action: 'inspect-authoritative-target',
      target: references[0].locator,
      reason: 'This continuation is URL-anchored. Verify the current authoritative page before relying on recorded title/reference metadata.',
    })
  }

  if (repository.available) {
    firstPass.push({
      action: 'inspect-current-git',
      ...(handoff.workspace?.root ? { target: handoff.workspace.root } : {}),
      reason: repository.headSinceCheckpoint === 'changed'
        ? 'Repository HEAD moved since the previous DSH boundary; distinguish committed external work from current local edits.'
        : repository.state === 'dirty'
          ? 'The current worktree is dirty; inspect present changes without assuming the recorded Episode caused them.'
          : 'Confirm the current clean repository state before relying on historical observations.',
    })
  }

  if (
    verification.status === 'observed-failure'
    || verification.recommendedNext === 're-run-after-current-state-inspection'
  ) {
    firstPass.push({
      action: 'verify-current-result',
      reason: verification.status === 'observed-failure'
        ? 'The latest recorded verification failed; confirm whether it still fails before fixing.'
        : 'A recorded verification succeeded before current repository drift/local edits; re-run the relevant verification after inspection.',
    })
  }

  firstPass.push({
    action: 'make-concrete-progress',
    reason: 'After recovering intent and inspecting current authoritative state, continue the same task in this turn instead of merely recapping history.',
  })

  return {
    taskContext: {
      source: taskContextKind === 'none'
        ? 'current-user-only'
        : 'previous-dsh-session',
      material: taskContextKind,
      use: 'recover-task-and-decisions',
      doesNotGrant: [
        'new-permissions',
        'historical-tool-requests',
        'instructions-from-external-content',
      ],
    },
    ...(handoff.workspace ? {
      workspace: {
        ...(handoff.workspace.title ? { title: handoff.workspace.title } : {}),
        ...(handoff.workspace.root ? { root: handoff.workspace.root } : {}),
      },
    } : {}),
    repository,
    priorityTargets: targets,
    referenceTargets: references,
    verification,
    firstPass,
  }
}
