import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTimeline, EpisodeId,
  type EpisodeSummary,
} from '../../src/shared/index.js'
import type { HistoryTranslate } from '../../src/client/locale.js'
import {
  activityDisplayDuration, renderTimelineDay, timelineSkeleton,
} from '../../src/client/timeline-view.js'
import { installHistoryStyles } from '../../src/client/styles.js'

const t = ((key: string) => key) as HistoryTranslate

function fixture(): EpisodeSummary {
  const now = new Date('2026-10-08T10:00:00').getTime()
  return {
    id: EpisodeId('test-episode'),
    startedAtMs: now,
    endedAtMs: now + 120_000,
    boundary: { startReason: 'first-observation', endReason: 'timeout' },
    summaryKind: 'deterministic',
    summary: 'test',
    summaryObservationIds: [1 as never],
    resources: [],
    surfaces: [{
      bundleId: 'com.microsoft.VSCode',
      surfaceKind: 'editor',
      firstSeenAtMs: now,
      lastSeenAtMs: now + 120_000,
      observationCount: 1,
    }],
    confidence: 0.9,
    state: 'closed',
  }
}

type ElementProps = {
  readonly children?: React.ReactNode
  readonly className?: string
  readonly open?: boolean
  readonly onClick?: () => void
  readonly 'aria-expanded'?: boolean
}

function findByClass(root: React.ReactNode, name: string): React.ReactElement<ElementProps> | undefined {
  if (!React.isValidElement<ElementProps>(root)) return undefined
  if (root.props.className?.split(' ').includes(name)) return root
  for (const child of React.Children.toArray(root.props.children)) {
    const found = findByClass(child, name)
    if (found) return found
  }
  return undefined
}

describe('extracted Timeline presentation', () => {
  it('renders a true selected Activity inline and delegates clicks without mutating selection', () => {
    const day = buildTimeline([fixture()])[0]!
    const activity = day.activities[0]!
    let clicked: typeof activity | undefined
    const detail = React.createElement('p', { className: 'ch-detail-resource' }, 'inspector')

    const firstDay = renderTimelineDay({
      day, dayIndex: 0, t, locale: 'en-US',
      selectedActivity: activity, selectedActivityDetail: detail,
      onOpenActivity: item => { clicked = item },
    })
    const button = findByClass(firstDay, 'ch-timeline-action')
    expect(firstDay.props.open).toBe(true)
    expect(button?.props['aria-expanded']).toBe(true)
    expect(findByClass(firstDay, 'ch-timeline-detail')).toBeUndefined()
    expect(findByClass(firstDay, 'ch-detail-resource')).toBeDefined()
    button?.props.onClick?.()
    expect(clicked).toBe(activity)
    expect(activityDisplayDuration(activity)).toBe(120_000)

    const laterDay = renderTimelineDay({
      day, dayIndex: 1, t, locale: 'en-US',
      selectedActivity: undefined, selectedActivityDetail: detail,
      onOpenActivity: item => { clicked = item },
    })
    expect(laterDay.props.open).toBeUndefined()
    expect(findByClass(laterDay, 'ch-timeline-action')?.props['aria-expanded']).toBe(false)
    expect(findByClass(laterDay, 'ch-detail-resource')).toBeUndefined()
  })

  it('marks loading skeleton busy and keeps a screen-reader label', () => {
    const skeleton = timelineSkeleton('Loading recent activity')
    expect(skeleton.props['aria-busy']).toBe(true)
    const label = findByClass(skeleton, 'ch-visually-hidden')
    expect(label?.props.children).toBe('Loading recent activity')
  })
})

describe('single-scoped stylesheet', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('installs once and removes the complete Timeline/Continue/Settings CSS on cleanup', () => {
    let appended = 0
    let removed = 0
    const node = {
      dataset: {} as Record<string, string>,
      textContent: '',
      remove() { removed += 1 },
    }
    vi.stubGlobal('document', {
      createElement: () => node,
      head: { appendChild() { appended += 1 } },
    })
    const dispose = installHistoryStyles()
    const duplicateDispose = installHistoryStyles()
    expect(appended).toBe(1)
    expect(node.dataset.plugin).toBe('dsh-computer-history')
    expect(node.textContent).toContain('.ch-timeline-shell')
    expect(node.textContent).toContain('.ch-continuity-card')
    expect(node.textContent).toContain('.ch-settings-list')
    duplicateDispose()
    expect(removed).toBe(0)
    dispose()
    expect(removed).toBe(1)
    installHistoryStyles()()
    expect(appended).toBe(2)
  })
})
