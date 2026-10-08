import React from 'react'
import type { EpisodeSummary, TimelineActivity, TimelineDay } from '../shared/index.js'
import { localDayKey } from '../shared/audit-view.js'
import { appIcon } from './app-icon.js'
import {
  episodeApp, episodeSubject, isHomeDirectoryResource,
} from './episode-subject.js'
import type { HistoryTranslate } from './locale.js'

// Pure presentation helpers: no Host queries, selectors, consent or mutations.
function skeletonLine(className = ''): React.ReactElement {
  return React.createElement('span', {
    className: `ch-skeleton-line${className ? ` ${className}` : ''}`,
  })
}

export function timelineSkeleton(label: string): React.ReactElement {
  return React.createElement(
    'div', { className: 'ch-skeleton-surface', 'aria-busy': true },
    React.createElement('span', { className: 'ch-visually-hidden', role: 'status' }, label),
    React.createElement(
      'div', { className: 'ch-skeleton-head', 'aria-hidden': true },
      skeletonLine('ch-skeleton-short'),
      skeletonLine('ch-skeleton-tiny'),
    ),
    ...Array.from({ length: 3 }, (_, index) => React.createElement(
      'div', { className: 'ch-skeleton-row', key: index, 'aria-hidden': true },
      skeletonLine('ch-skeleton-time'),
      React.createElement(
        'span', { className: 'ch-skeleton-copy' },
        skeletonLine(index === 1 ? 'ch-skeleton-medium' : 'ch-skeleton-long'),
        skeletonLine('ch-skeleton-small'),
      ),
      skeletonLine('ch-skeleton-tiny'),
    )),
  )
}

export function threadSkeleton(label: string): React.ReactElement {
  return React.createElement(
    'div', { className: 'ch-skeleton-thread', 'aria-busy': true },
    React.createElement('span', { className: 'ch-visually-hidden', role: 'status' }, label),
    React.createElement(
      'span', { className: 'ch-skeleton-copy', 'aria-hidden': true },
      skeletonLine('ch-skeleton-medium'),
      skeletonLine('ch-skeleton-small'),
    ),
    skeletonLine('ch-skeleton-tiny'),
  )
}


export function resourceLabel(
  t: HistoryTranslate,
  resource: { readonly kind: string; readonly canonicalUri: string; readonly displayLabel?: string },
  app?: string,
): string {
  if (app === 'Terminal' && isHomeDirectoryResource(resource)) return t('homeDirectory')
  return resource.displayLabel ?? resource.canonicalUri
}

export function episodeMeta(
  t: HistoryTranslate,
  episode: EpisodeSummary | TimelineActivity,
  app: string,
): string {
  const resource = episode.lastStrongResource ?? episode.resources[0]
  if (!resource) return app
  const label = resourceLabel(t, resource, app)
  const subject = episodeSubject(t, episode)
  if (app === 'Terminal' && label === t('homeDirectory')) return label
  return label && label != subject ? `${app} · ${label}` : app
}

export function formatClock(atMs: number, locale: string): string {
  return new Intl.DateTimeFormat(locale || undefined, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(atMs))
}

export function formatDuration(t: HistoryTranslate, milliseconds: number): string {
  const safeMilliseconds = Math.max(0, milliseconds)
  if (safeMilliseconds < 60_000) {
    const seconds = Math.max(1, Math.round(safeMilliseconds / 1_000))
    return t('seconds', { seconds })
  }
  const totalMinutes = Math.round(safeMilliseconds / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return t('durationHoursMinutes', { hours, minutes })
  if (hours > 0) return t('durationHours', { hours })
  return t('minutes', { minutes })
}

export function formatRelativeAge(t: HistoryTranslate, atMs: number): string {
  const elapsed = Math.max(0, Date.now() - atMs)
  if (elapsed < 60_000) return t('justNow')
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return t('minutesAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('hoursAgo', { hours })
  return t('daysAgo', { days: Math.floor(hours / 24) })
}

export function activityDisplayDuration(activity: TimelineActivity): number {
  return activity.episodeCount > 1
    ? activity.spanDurationMs
    : activity.observedDurationMs
}

export function activityDurationText(t: HistoryTranslate, activity: TimelineActivity): string {
  const duration = formatDuration(t, activityDisplayDuration(activity))
  return activity.episodeCount > 1
    ? t('approxDuration', { duration })
    : duration
}

export function dayDuration(day: TimelineDay): number {
  return day.activities.reduce(
    (total, activity) => total + activityDisplayDuration(activity),
    0,
  )
}

export function dayLabel(t: HistoryTranslate, dayKey: string): string {
  const today = localDayKey(Date.now())
  if (dayKey === today) return t('today')
  const yesterday = localDayKey(Date.now() - 86_400_000)
  if (dayKey === yesterday) return t('yesterday')
  return dayKey
}

export function formatDayDate(dayKey: string, locale: string): string {
  const date = new Date(`${dayKey}T12:00:00`)
  const dateText = new Intl.DateTimeFormat(locale || undefined, {
    month: 'short', day: 'numeric',
  }).format(date)
  const weekday = new Intl.DateTimeFormat(locale || undefined, {
    weekday: 'short',
  }).format(date)
  return `${dateText} · ${weekday}`
}

interface TimelineDayViewProps {
  readonly t: HistoryTranslate
  readonly day: TimelineDay
  readonly dayIndex: number
  readonly locale: string
  readonly selectedActivity: TimelineActivity | undefined
  readonly selectedActivityDetail: React.ReactNode
  readonly onOpenActivity: (activity: TimelineActivity) => void
}

// Caller owns the selection state and the action; this function renders data only.
export function renderTimelineDay({
  t, day, dayIndex, locale, selectedActivity, selectedActivityDetail, onOpenActivity,
}: TimelineDayViewProps): React.ReactElement {
  const duration = formatDuration(t, dayDuration(day))
  const displayDuration = day.activities.some(activity => activity.episodeCount > 1)
    ? t('approxDuration', { duration })
    : duration
  const maxActivityDuration = Math.max(
    1,
    ...day.activities.map(activityDisplayDuration),
  )
  return React.createElement(
    'details', {
      key: day.dayKey,
      className: 'ch-day',
      open: dayIndex === 0 ? true : undefined,
    },
    React.createElement(
      'summary', { className: 'ch-day-summary' },
      React.createElement('span', { className: 'ch-day-title' }, dayLabel(t, day.dayKey)),
      React.createElement('span', { className: 'ch-day-date' }, formatDayDate(day.dayKey, locale)),
      React.createElement('span', { className: 'ch-day-total' },
        t('daySummary', {
          duration: displayDuration,
          count: day.activityCount,
        })),
      React.createElement('span', { className: 'ch-day-chevron', 'aria-hidden': true }, '⌄'),
    ),
    React.createElement(
      'ul', { className: 'ch-timeline-list' },
      ...day.activities.map(activity => {
        const app = episodeApp(activity)
        const isSelected = selectedActivity?.activityKey === activity.activityKey
        return React.createElement(
          'li', { key: activity.activityKey, className: 'ch-timeline-item' },
          React.createElement('span', { className: 'ch-time' },
            `${formatClock(activity.startedAtMs, locale)}–${formatClock(activity.endedAtMs, locale)}`),
          React.createElement(
            'button', {
              type: 'button',
              className: isSelected
                ? 'ch-timeline-action ch-timeline-action-selected'
                : 'ch-timeline-action',
              'aria-expanded': isSelected,
              onClick: () => { onOpenActivity(activity) },
            },
            appIcon(activity.surfaces[0]?.bundleId, app),
            React.createElement(
              'span', { className: 'ch-episode-copy' },
              React.createElement('span', { className: 'ch-episode-title' }, episodeSubject(t, activity)),
              React.createElement('span', { className: 'ch-episode-meta' }, episodeMeta(t, activity, app)),
            ),
          ),
          React.createElement(
            'span', { className: 'ch-duration-wrap' },
            React.createElement('span', { className: 'ch-duration' },
              activityDurationText(t, activity)),
            React.createElement(
              'span', { className: 'ch-duration-track', 'aria-hidden': true },
              React.createElement('span', {
                className: 'ch-duration-fill',
                style: {
                  width: `${Math.max(
                    10,
                    Math.round(activityDisplayDuration(activity) / maxActivityDuration * 100),
                  )}%`,
                },
              }),
            ),
          ),
          isSelected ? selectedActivityDetail : null,
        )
      }),
    ),
  )
}
