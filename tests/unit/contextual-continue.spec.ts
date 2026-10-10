import { describe, expect, it } from 'vitest'
import {
  type ProjectMemory, type ThreadActivityLinks,
} from '../../src/shared/index.js'
import { projectContextualContinue } from '../../src/host/memory/contextual-continue.js'

const ID = 'pm_' + 'a'.repeat(64)
const SOURCE = 'episode:bound'
const project: ProjectMemory = {
  id: ID, title: 'Alpha',
  lastActiveAtMs: 1000, episodeCount: 12,
  recentEpisodeIds: [SOURCE],
  status: 'active',
  facts: [
    {
      id: 'mf1', kind: 'workspace', text: 'Workspace: Alpha',
      evidenceLevel: 'observation-backed', sourceEpisodeIds: [SOURCE],
      observedAtMs: 1000,
    },
    {
      id: 'mf2', kind: 'verification',
      text: 'Historically observed test success (recheck current state)',
      evidenceLevel: 'episode-compacted',
      sourceEpisodeIds: [SOURCE],
      observedAtMs: 950,
    },
  ],
}
const links: ThreadActivityLinks = {
  projectMemoryId: ID,
  scannedEpisodes: 13,
  scanTruncated: false,
  caveat: 'untrusted',
  links: [{
    episodeId: 'nearby', anchorEpisodeId: SOURCE,
    kind: 'nearby-unassigned', attribution: 'unattributed',
    observedAtMs: 1010, label: 'Terminal',
    appBundleIds: ['Terminal'],
    sourceEvidence: 'observation-backed',
  }, {
    episodeId: 'exact', anchorEpisodeId: SOURCE,
    kind: 'exact-resource', attribution: 'resource-linked',
    observedAtMs: 980, label: 'Editor',
    appBundleIds: ['Editor'],
    sharedResourceUri: 'file:///alpha/code.ts',
    sourceEvidence: 'episode-compacted',
  }],
}

describe('M5 contextual Continue projection', () => {
  it('uses exact project identity, not fuzzy workspace titles', () => {
    expect(() => projectContextualContinue(
      SOURCE, project, { ...links, projectMemoryId: 'pm_' + 'b'.repeat(64) },
    )).toThrow(/identity mismatch/)
  })

  it('projects bounded historical facts and keeps current state unverified', () => {
    const value = projectContextualContinue(SOURCE, project, links)
    expect(value).toMatchObject({
      status: 'ready', boundEpisodeId: SOURCE,
      project: { id: ID, title: 'Alpha', episodeCount: 12 },
      facts: [
        { kind: 'workspace', sourceEpisodeIds: [SOURCE] },
        { kind: 'verification', evidenceLevel: 'episode-compacted' },
      ],
      privacy: {
        userConfirmedNotes: 'excluded',
        unrelatedProjects: 'excluded',
        askYourHistory: 'not-auto-run',
        readMode: 'bound-session-on-demand',
      },
    })
    expect(value.caveat).toContain('not proof')
    expect(value.caveat).toContain('Observation IDs may outlive')
    expect(JSON.stringify(value)).not.toContain('long-term private text')
  })

  it('never upgrades a temporal hint into assigned work', () => {
    const value = projectContextualContinue(SOURCE, project, links)
    expect(value.relatedActivity[0]).toMatchObject({
      kind: 'nearby-unassigned', attribution: 'unattributed',
    })
    expect(value.relatedActivity[0]).not.toHaveProperty('sharedResourceUri')
    expect(value.relatedActivity[1]).toMatchObject({
      kind: 'exact-resource', sharedResourceUri: 'file:///alpha/code.ts',
    })
    expect(value.caveat).toContain('UNATTRIBUTED')
  })

  it('omits derived fact entries without any Episode citation', () => {
    const value = projectContextualContinue(SOURCE, {
      ...project, facts: [...project.facts, {
        id: 'unbacked', kind: 'activity', text: 'unbacked',
        evidenceLevel: 'episode-compacted', sourceEpisodeIds: [],
      }],
    }, links)
    expect(value.facts.map(f => f.text)).not.toContain('unbacked')
  })

  it('bounds facts, source IDs, text, and cross-application links', () => {
    const longProject: ProjectMemory = {
      ...project, title: 'P'.repeat(500),
      facts: Array.from({ length: 20 }, (_, i) => ({
        id: 'f' + i, kind: 'resource' as const,
        text: 'x'.repeat(900),
        evidenceLevel: 'observation-backed' as const,
        sourceEpisodeIds: ['s1', 's2', 's3', 's4', 's5'],
      })),
    }
    const manyLinks: ThreadActivityLinks = {
      ...links,
      links: Array.from({ length: 10 }, (_, i) => ({
        ...links.links[1]!,
        episodeId: 'e' + i,
        appBundleIds: Array.from({ length: 10 }, (_unused, j) => 'app' + j),
        sharedResourceUri: 'file:///' + 'x'.repeat(2500),
      })),
    }
    const result = projectContextualContinue(SOURCE, longProject, manyLinks)
    expect(result.project.title.length).toBe(256)
    expect(result.facts).toHaveLength(8)
    expect(result.facts[0]?.text.length).toBe(240)
    expect(result.facts[0]?.sourceEpisodeIds).toHaveLength(3)
    expect(result.relatedActivity).toHaveLength(4)
    expect(result.relatedActivity[0]?.appBundleIds).toHaveLength(4)
    expect(result.relatedActivity[0]?.sharedResourceUri?.length).toBe(2048)
    expect(result.scanTruncated).toBe(true)
  })

  it('is deterministic and does not mutate source objects', () => {
    const baseline = JSON.stringify({ project, links })
    const one = projectContextualContinue(SOURCE, project, links)
    const two = projectContextualContinue(SOURCE, project, links)
    expect(one).toEqual(two)
    expect(JSON.stringify({ project, links })).toBe(baseline)
  })
})
