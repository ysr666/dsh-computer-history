import type {
  ContextualContinueResult,
  ContextualContinueFact,
  ContextualContinueLink,
  ProjectMemory,
  ThreadActivityLinks,
} from '../../shared/index.js'

const MAX_FACTS = 8
const MAX_FACT_CHARS = 240
const MAX_LINKS = 4

/**
 * Pure bounded projection of already-provenanced history.
 * No inference of task completion and NO user-confirmed note access.
 */
export function projectContextualContinue(
  boundEpisodeId: string,
  project: ProjectMemory,
  related: ThreadActivityLinks,
): Extract<ContextualContinueResult, { status: 'ready' }> {
  if (project.id !== related.projectMemoryId) {
    throw new Error('contextual Continue project identity mismatch')
  }
  const facts = project.facts
    .filter(fact => fact.sourceEpisodeIds.length > 0)
    .slice(0, MAX_FACTS)
    .map(fact => {
      const item: ContextualContinueFact = {
        kind: fact.kind,
        text: fact.text.slice(0, MAX_FACT_CHARS),
        evidenceLevel: fact.evidenceLevel,
        sourceEpisodeIds: fact.sourceEpisodeIds.slice(0, 3),
      }
      return fact.observedAtMs === undefined
        ? item : Object.assign(item, { observedAtMs: fact.observedAtMs })
    })
  const relatedActivity = related.links.slice(0, MAX_LINKS).map(link => {
    const item: ContextualContinueLink = {
      episodeId: link.episodeId,
      anchorEpisodeId: link.anchorEpisodeId,
      kind: link.kind,
      attribution: link.attribution,
      observedAtMs: link.observedAtMs,
      appBundleIds: link.appBundleIds.slice(0, 4),
      sourceEvidence: link.sourceEvidence,
    }
    return link.kind === 'exact-resource' && link.sharedResourceUri
      ? Object.assign(item, { sharedResourceUri: link.sharedResourceUri.slice(0, 2_048) })
      : item
  })
  return {
    status: 'ready',
    boundEpisodeId,
    project: {
      id: project.id,
      title: project.title.slice(0, 256),
      episodeCount: project.episodeCount,
      lastObservedAtMs: project.lastActiveAtMs,
    },
    facts,
    relatedActivity,
    scanTruncated: related.scanTruncated || related.links.length > MAX_LINKS
      || project.facts.length > MAX_FACTS,
    privacy: {
      userConfirmedNotes: 'excluded',
      unrelatedProjects: 'excluded',
      askYourHistory: 'not-auto-run',
      readMode: 'bound-session-on-demand',
    },
    caveat: [
      'Historical metadata, not proof of current task completion.',
      'Confirm real file contents, repository state and test results before acting.',
      'Nearby M4 activity is UNATTRIBUTED, even when it shares time with the project.',
      'Observation IDs may outlive underlying raw rows; recheck evidence if needed.',
      'This read never includes user-confirmed M2 notes or unrelated projects.',
    ].join(' '),
  }
}
