import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RetentionService, DeletionService } from '../../src/host/retention/index.js'
import {
  CollectorSessionId, EpisodeId, type ActivityObservation,
} from '../../src/shared/index.js'
import {
  EpisodeStore, ObservationStore, ResourceStore, openHistoryDatabase,
} from '../../src/host/store/index.js'

const tempRoots: string[] = []
const NOW = 500_000

function harness() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dch-agent-facets-'))
  tempRoots.push(root)
  const history = openHistoryDatabase({
    dataDirectory: path.join(root, 'history'),
    nowMs: 1,
  })
  const episodes = new EpisodeStore(history.db)
  const observations = new ObservationStore(history.db)
  const resources = new ResourceStore(history.db)

  function add(input: {
    id: string
    kind: 'file' | 'url' | 'document'
    uri: string
    app: string
    at: number
    event?: 'save' | 'verify-test-success'
    expiresAt?: number
  }) {
    const observation: ActivityObservation = {
      collectorSessionId: CollectorSessionId('synthetic-test'),
      seq: input.at,
      observedAtMs: input.at,
      app: { pid: 42, bundleId: input.app },
      surface: { kind: input.kind === 'url' ? 'browser' : 'editor' },
      resource: {
        kind: input.kind,
        canonicalUri: input.uri,
        displayLabel: input.uri.split('/').at(-1) ?? '',
      },
      workspace: {
        id: 'TripMap', root: '/TripMap', title: 'TripMap',
        source: 'dsh', confidence: 1,
      },
      activity: input.event ? { event: input.event } : {},
      privacy: { secure: false, protected: false },
      source: { provider: 'macos-ax', adapter: 'vscode' },
      policyRevision: 1,
      expiresAtMs: NOW + 10_000,
    }
    const resourceId = resources.upsert(observation.resource!, observation.observedAtMs)
    const observationId = observations.insert(observation, resourceId)
    const id = EpisodeId(input.id)
    episodes.replace({
      id, startedAtMs: input.at, endedAtMs: input.at,
      startReason: 'first-observation', endReason: 'timeout',
      workspace: { id: 'TripMap', root: '/TripMap', title: 'TripMap' },
      threadKey: 'workspace:TripMap',
      lastStrongResourceId: resourceId,
      summaryKind: 'deterministic',
      summary: 'Observed activity in TripMap',
      confidence: 1, state: 'closed',
      createdAtMs: input.at, updatedAtMs: input.at,
      expiresAtMs: input.expiresAt ?? NOW + 10_000,
      observationIds: [observationId],
    })
    return id
  }
  return { history, episodes, add, resources, observations, root }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AI-first structured history evidence', () => {
  it('finds URL resources without requiring browser-related words in a title', () => {
    const { history, episodes, add } = harness()
    add({ id: 'url', kind: 'url', uri: 'https://example.org/guide',
      app: 'com.google.Chrome', at: 490_000 })
    add({ id: 'file', kind: 'file', uri: 'file:///TripMap/routes.ts',
      app: 'com.microsoft.VSCode', at: 489_000, event: 'save' })
    const hit = episodes.queryEvidence({ resourceKind: 'url', limit: 10 }, NOW)
    expect(hit.items.map(ep => String(ep.id))).toEqual(['url'])
    expect(hit.items[0]?.resources[0]?.kind).toBe('url')
    expect(episodes.queryEvidence({
      resourceKind: 'file', eventKind: 'save',
    }, NOW).items.map(ep => String(ep.id))).toEqual(['file'])
    history.close()
  })

  it('treats literal metadata text safely, without LIKE wildcard expansion', () => {
    const { history, episodes, add } = harness()
    add({ id: 'f1', kind: 'file', uri: 'file:///TripMap/model.step',
      app: 'com.example.CAD', at: 490_000 })
    expect(episodes.queryEvidence({ text: 'model.step' }, NOW).items
      .map(ep => String(ep.id))).toEqual(['f1'])
    expect(episodes.queryEvidence({ text: '%' }, NOW).items).toEqual([])
    expect(episodes.queryEvidence({ text: '_' }, NOW).items).toEqual([])
    history.close()
  })

  it('works with arbitrary CAD, research, and browser applications without application-name dictionaries', () => {
    const { history, episodes, add } = harness()
    add({ id: 'cad', kind: 'file', uri: 'file:///Projects/robot-arm/model.step',
      app: 'com.vendor.cad-suite', at: 490_000 })
    add({ id: 'research', kind: 'url', uri: 'https://example.edu/papers/robotics',
      app: 'org.example.browser', at: 491_000 })
    expect(episodes.queryEvidence({
      bundleId: 'com.vendor.cad-suite',
    }, NOW).items.map(ep => String(ep.id))).toEqual(['cad'])
    expect(episodes.queryEvidence({
      resourceKind: 'url',
    }, NOW).items.map(ep => String(ep.id))).toEqual(['research'])
    history.close()
  })

  it('does not mistake a viewed file for a saved file when another resource was saved', () => {
    const { history, episodes, add } = harness()
    const mixedId = add({ id: 'mixed-file-view-and-url-save',
      kind: 'file', uri: 'file:///TripMap/unsaved.step',
      app: 'com.synthetic.cad', at: 480_000 })
    const urlId = add({ id: 'saved-url',
      kind: 'url', uri: 'https://example.org/synthetic-page',
      app: 'com.synthetic.browser', at: 481_000, event: 'save' })
    const actualSavedId = add({ id: 'actually-saved-file',
      kind: 'file', uri: 'file:///TripMap/saved.step',
      app: 'com.synthetic.cad', at: 482_000, event: 'save' })

    // One work Episode contains BOTH a viewed file and a saved URL, but
    // it has NOT saved that file. The existence checks must correlate.
    const viewed = episodes.get(mixedId)!
    const savedUrl = episodes.get(urlId)!
    episodes.replace({
      id: mixedId, startedAtMs: 480_000, endedAtMs: 481_000,
      startReason: 'first-observation', endReason: 'timeout',
      workspace: { id: 'TripMap', root: '/TripMap', title: 'TripMap' },
      threadKey: 'workspace:TripMap', summaryKind: 'deterministic',
      summary: 'Viewed a STEP file, separately saved a URL',
      confidence: 1, state: 'closed',
      createdAtMs: 480_000, updatedAtMs: 481_000,
      expiresAtMs: NOW + 10_000,
      observationIds: [
        viewed.observationIds[0]!,
        savedUrl.observationIds[0]!,
      ],
    })
    expect(episodes.queryEvidence({
      resourceKind: 'url', eventKind: 'save',
    }, NOW).items.map(x => String(x.id))).toContain(String(mixedId))
    expect(episodes.queryEvidence({
      resourceKind: 'file', eventKind: 'save',
    }, NOW).items.map(x => String(x.id))).toEqual([String(actualSavedId)])

    // This correlation must remain true after raw observation compaction:
    // the retained saved_resources table still knows exact resource kinds.
    history.db.prepare('DELETE FROM observations').run()
    expect(episodes.queryEvidence({
      resourceKind: 'file', eventKind: 'save',
    }, NOW).items.map(x => String(x.id))).toEqual([String(actualSavedId)])
    history.close()
  })

  it('never attributes an unsaved named resource to a different saved resource in the same Episode', () => {
    const { history, episodes, add } = harness()
    const mixed = add({ id: 'mixed-name', kind: 'file',
      uri: 'file:///synthetic/unsaved_model.step',
      app: 'com.synthetic.cad', at: 480_000 })
    const other = add({ id: 'other-save', kind: 'file',
      uri: 'file:///synthetic/saved_assembly.step',
      app: 'com.synthetic.cad', at: 481_000, event: 'save' })
    const saved = add({ id: 'actual-save', kind: 'file',
      uri: 'file:///synthetic/unsaved_model.step',
      app: 'com.synthetic.cad', at: 482_000, event: 'save' })
    const viewed = episodes.get(mixed)!
    const savedOther = episodes.get(other)!
    episodes.replace({
      id: mixed, startedAtMs: 480_000, endedAtMs: 481_000,
      startReason: 'first-observation', endReason: 'timeout',
      workspace: { id: 'TripMap', root: '/TripMap', title: 'TripMap' },
      threadKey: 'workspace:TripMap', summaryKind: 'deterministic',
      summary: 'Looked at unsaved_model.step, saved assembly separately',
      confidence: 1, state: 'closed', createdAtMs: 480_000,
      updatedAtMs: 481_000, expiresAtMs: NOW + 10_000,
      observationIds: [viewed.observationIds[0]!, savedOther.observationIds[0]!],
    })
    const filters = { resourceKind: 'file' as const, eventKind: 'save' as const,
      resourceText: 'unsaved_model.step' }
    expect(episodes.queryEvidence(filters, NOW).items.map(x => String(x.id)))
      .toEqual([String(saved)])
    // A resource name without an explicit kind must still refer to the
    // actually saved resource, not any visited resource in the Episode.
    expect(episodes.queryEvidence({
      eventKind: 'save', resourceText: 'unsaved_model.step',
    }, NOW).items.map(x => String(x.id))).toEqual([String(saved)])
    // The same literal without a save qualifier still finds viewed resources.
    expect(episodes.queryEvidence({
      resourceKind: 'file', resourceText: 'unsaved_model.step',
    }, NOW).items.map(x => String(x.id))).toEqual([String(saved), String(mixed)])
    // Source matches must remain tied to the same save after raw TTL.
    history.db.prepare('DELETE FROM observations').run()
    expect(episodes.queryEvidence(filters, NOW).items.map(x => String(x.id)))
      .toEqual([String(saved)])
    // Literal matching: SQL wildcard characters are not interpreted.
    expect(episodes.queryEvidence({ ...filters, resourceText: '%' }, NOW).items)
      .toEqual([])
    history.close()
  })

  it('retrieves documents and code across arbitrary apps without browser-specific rules', () => {
    const { history, episodes, add } = harness()
    add({ id: 'paper', kind: 'document',
      uri: 'file:///synthetic/QA-Research/notes.docx',
      app: 'org.synthetic.wordprocessor', at: 490_000 })
    add({ id: 'python', kind: 'file',
      uri: 'file:///synthetic/QA-RobotArm/controller.py',
      app: 'com.synthetic.ide', at: 491_000, event: 'save' })
    expect(episodes.queryEvidence({
      resourceKind: 'document',
    }, NOW).items.map(item => String(item.id))).toEqual(['paper'])
    expect(episodes.queryEvidence({
      resourceKind: 'file', eventKind: 'save', bundleId: 'com.synthetic.ide',
    }, NOW).items.map(item => String(item.id))).toEqual(['python'])
    expect(episodes.queryEvidence({
      text: 'notes.docx', resourceKind: 'document',
    }, NOW).items.map(item => String(item.id))).toEqual(['paper'])
    history.close()
  })

  it('supports separate evidence calls for save and test in one natural-language task', () => {
    const { history, episodes, add } = harness()
    add({ id: 'saved', kind: 'file', uri: 'file:///TripMap/routes.ts',
      app: 'com.microsoft.VSCode', at: 490_000, event: 'save' })
    add({ id: 'tested', kind: 'file', uri: 'file:///TripMap/tests.ts',
      app: 'com.microsoft.VSCode', at: 491_000, event: 'verify-test-success' })
    const saved = episodes.queryEvidence({ eventKind: 'save' }, NOW)
    const tested = episodes.queryEvidence({ eventKind: 'test' }, NOW)
    expect(saved.items.map(ep => String(ep.id))).toEqual(['saved'])
    expect(tested.items.map(ep => String(ep.id))).toEqual(['tested'])
    history.close()
  })

  it('filters old history by time without a recent-1000-episode pre-scan', () => {
    const { history, episodes, add } = harness()
    add({ id: 'old', kind: 'url', uri: 'https://example.org/older',
      app: 'com.google.Chrome', at: 100_000 })
    add({ id: 'new', kind: 'url', uri: 'https://example.org/newer',
      app: 'com.google.Chrome', at: 490_000 })
    expect(episodes.queryEvidence({
      resourceKind: 'url', untilMs: 150_000,
    }, NOW).items.map(ep => String(ep.id))).toEqual(['old'])
    history.close()
  })

  it('uses a stable keyset cursor across equal timestamps', () => {
    const { history, episodes, add } = harness()
    for (const id of ['a', 'b', 'c']) {
      add({ id, kind: 'file', uri: 'file:///TripMap/' + id + '.ts',
        app: 'com.microsoft.VSCode', at: 490_000 + id.charCodeAt(0) - 97 })
    }
    const first = episodes.queryEvidence({ limit: 2 }, NOW)
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBeDefined()
    const second = episodes.queryEvidence({ limit: 2, cursor: first.nextCursor! }, NOW)
    expect([...first.items, ...second.items].map(ep => String(ep.id))).toEqual(['c', 'b', 'a'])
    expect(second.hasMore).toBe(false)
    history.close()
  })

  it('retains verified compacted save facts after raw observations expire', () => {
    const { history, episodes, add } = harness()
    add({ id: 'old-save', kind: 'file', uri: 'file:///TripMap/routes.ts',
      app: 'com.microsoft.VSCode', at: 400_000, event: 'save' })
    expect(episodes.queryEvidence({ eventKind: 'save' }, NOW).items).toHaveLength(1)
    // The fact is aggregated *from actual observations before expiry*.
    // It survives only while the parent Episode is retained.
    history.db.prepare('DELETE FROM observations').run()
    expect(episodes.queryEvidence({ resourceKind: 'file' }, NOW).items).toHaveLength(1)
    const saved = episodes.queryEvidence({ eventKind: 'save' }, NOW).items
    expect(saved.map(item => String(item.id))).toEqual(['old-save'])
    expect(saved[0]?.changedResources?.[0]?.canonicalUri).toBe(
      'file:///TripMap/routes.ts')
    history.close()
  })

  it('keeps saved file and test facts after the real TTL sweep, and forget deletes both', () => {
    const { history, episodes, add } = harness()
    add({ id: 'saved', kind: 'file', uri: 'file:///TripMap/arm.step',
      app: 'com.example.CAD', at: 488_000, event: 'save' })
    add({ id: 'checked', kind: 'file', uri: 'file:///TripMap/test.ts',
      app: 'com.example.CAD', at: 489_000, event: 'verify-test-success' })
    history.db.prepare('UPDATE observations SET expires_at_ms = ?').run(NOW - 1)
    expect(new RetentionService(history.db).sweep(NOW)).toEqual({
      observationsDeleted: 2, episodesDeleted: 0,
    })
    expect(episodes.queryEvidence({ eventKind: 'save' }, NOW).items.map(
      value => String(value.id))).toEqual(['saved'])
    const checks = episodes.queryEvidence({ eventKind: 'test' }, NOW).items
    expect(checks.map(value => String(value.id))).toEqual(['checked'])
    expect(checks[0]?.verifications).toMatchObject([
      { kind: 'test', result: 'success', observationCount: 1 },
    ])
    const result = new DeletionService(history.db).delete({
      scope: { kind: 'app', bundleId: 'com.example.CAD' },
    }, NOW)
    expect(result.episodesDeleted).toBe(2)
    expect(episodes.queryEvidence({ eventKind: 'save' }, NOW).items).toEqual([])
    expect(episodes.queryEvidence({ eventKind: 'test' }, NOW).items).toEqual([])
    expect(history.db.prepare('SELECT COUNT(*) AS count FROM episode_saved_resources').get())
      .toEqual({ count: 0 })
    expect(history.db.prepare('SELECT COUNT(*) AS count FROM episode_verification_results').get())
      .toEqual({ count: 0 })
    history.close()
  })

  it.each(['time-range', 'episode', 'all'] as const)(
    'forgets all retained event facts under %s after raw expiry',
    (kind) => {
      const { history, episodes, add } = harness()
      const episodeId = add({ id: 'forget-' + kind, kind: 'file',
        uri: 'file:///TripMap/private.step', app: 'com.example.CAD',
        at: 490_000, event: 'save' })
      history.db.prepare('UPDATE observations SET expires_at_ms = ?').run(NOW - 1)
      new RetentionService(history.db).sweep(NOW)
      expect(episodes.queryEvidence({ eventKind: 'save' }, NOW).items).toHaveLength(1)
      const scope = kind === 'time-range'
        ? { kind: 'time-range' as const, startMs: 489_000, endMs: 491_000 }
        : kind === 'episode'
          ? { kind: 'episode' as const, episodeId }
          : { kind: 'all' as const }
      new DeletionService(history.db).delete({ scope }, NOW)
      expect(episodes.get(episodeId)).toBeUndefined()
      expect(history.db.prepare('SELECT COUNT(*) AS count FROM episode_saved_resources').get())
        .toEqual({ count: 0 })
      history.close()
    },
  )

  it('removes retained event aggregates when the parent Episode TTL expires', () => {
    const { history, episodes, add } = harness()
    add({ id: 'expire-event', kind: 'file',
      uri: 'file:///TripMap/private.step', app: 'com.example.CAD',
      at: 490_000, event: 'save', expiresAt: NOW + 2 })
    expect(episodes.queryEvidence({ eventKind: 'save' }, NOW).items).toHaveLength(1)
    new RetentionService(history.db).sweep(NOW + 10)
    expect(episodes.queryEvidence({ eventKind: 'save' }, NOW + 10).items).toEqual([])
    expect(history.db.prepare('SELECT COUNT(*) AS count FROM episode_saved_resources').get())
      .toEqual({ count: 0 })
    history.close()
  })

  it('backfills only provable raw events when upgrading a v15 database', () => {
    const { history, add, root } = harness()
    add({ id: 'historic-save', kind: 'file', uri: 'file:///TripMap/a.ts',
      app: 'com.example.Editor', at: 490_000, event: 'save' })
    add({ id: 'historical-gap', kind: 'file', uri: 'file:///TripMap/b.ts',
      app: 'com.example.Editor', at: 491_000, event: 'save' })
    history.db.prepare('DELETE FROM observations WHERE observed_at_ms = ?')
      .run(491_000)
    history.db.exec('DROP TABLE episode_saved_resources')
    history.db.exec('DROP TABLE episode_verification_results')
    history.db.prepare('DELETE FROM schema_migrations WHERE version = 16').run()
    history.db.exec('PRAGMA user_version = 15')
    history.close()
    const upgraded = openHistoryDatabase({
      dataDirectory: path.join(root, 'history'), nowMs: NOW,
    })
    const migrated = new EpisodeStore(upgraded.db).queryEvidence({
      eventKind: 'save',
    }, NOW)
    expect(migrated.items.map(item => String(item.id))).toEqual(['historic-save'])
    expect(new EpisodeStore(upgraded.db).queryEvidence({
      eventKind: 'save', text: 'b.ts',
    }, NOW).items).toEqual([])
    expect(upgraded.db.prepare('PRAGMA user_version').get()).toEqual({
      user_version: 16,
    })
    upgraded.close()
  })

  it('reconciles append-only event aggregates without double-counting', () => {
    const { history, episodes, add, observations, resources } = harness()
    const episodeId = add({ id: 'same', kind: 'file',
      uri: 'file:///TripMap/a.ts', app: 'com.example.Editor',
      at: 485_000, event: 'save' })
    const second: ActivityObservation = {
      collectorSessionId: CollectorSessionId('synthetic-test'),
      seq: 486_000, observedAtMs: 486_000,
      app: { pid: 42, bundleId: 'com.example.Editor' },
      surface: { kind: 'editor' as const },
      resource: { kind: 'file' as const,
        canonicalUri: 'file:///TripMap/a.ts' },
      workspace: { id: 'TripMap', root: '/TripMap', title: 'TripMap',
        source: 'dsh' as const, confidence: 1 },
      activity: { event: 'save' as const },
      privacy: { secure: false, protected: false },
      source: { provider: 'macos-ax' as const, adapter: 'vscode' },
      policyRevision: 1, expiresAtMs: NOW + 10_000,
    }
    const resourceId = resources.upsert(second.resource!, second.observedAtMs)
    const rawId = observations.insert(second, resourceId)
    const firstId = episodes.get(episodeId)!.observationIds[0]!
    const update = {
      id: episodeId, startedAtMs: 485_000, endedAtMs: 486_000,
      startReason: 'first-observation' as const,
      endReason: 'timeout' as const,
      summaryKind: 'deterministic' as const, summary: 'Observed activity in TripMap',
      confidence: 1, state: 'closed' as const, createdAtMs: 485_000,
      updatedAtMs: 486_000, expiresAtMs: NOW + 10_000,
      observationIds: [firstId, rawId],
    }
    episodes.replace(update, {
      provenance: 'append', appendObservationIds: [rawId],
    })
    // Repeated same append must not inflate the durable event count.
    episodes.replace(update, {
      provenance: 'append', appendObservationIds: [rawId],
    })
    expect(episodes.get(episodeId)?.changedResources).toMatchObject([
      { canonicalUri: 'file:///TripMap/a.ts', changeCount: 2 },
    ])
    history.close()
  })

  it('does not return expired Episode metadata even before the retention sweep', () => {
    const { history, episodes, add } = harness()
    add({ id: 'expired', kind: 'url', uri: 'https://example.org/expired',
      app: 'com.google.Chrome', at: 400_000, expiresAt: NOW - 1 })
    expect(episodes.queryEvidence({ resourceKind: 'url' }, NOW).items).toEqual([])
    history.close()
  })
})
