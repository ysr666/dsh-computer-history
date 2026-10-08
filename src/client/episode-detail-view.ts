import React from 'react'
import type { EpisodeDetail, EpisodeSummary, TimelineActivity } from '../shared/index.js'
import { TIMELINE_ACTIVITY_MERGE_GAP_MS } from '../shared/audit-view.js'
import { episodeApp, friendlyAppName } from './episode-subject.js'
import type { HistoryTranslate } from './locale.js'
import { episodeMeta, formatClock, resourceLabel } from './timeline-view.js'

interface EpisodeDetailViewProps {
  readonly t: HistoryTranslate
  readonly selectedActivity: TimelineActivity
  readonly selected: EpisodeDetail
  readonly selectedRawEpisodes: readonly EpisodeSummary[]
  readonly activeLocale: string
}

// Inspect only the exact selected activity's evidence; no new selection logic.
export function renderSelectedActivityDetail({
  t, selectedActivity, selected, selectedRawEpisodes, activeLocale,
}: EpisodeDetailViewProps): React.ReactElement {
  return React.createElement(
          'div', { className: 'ch-detail ch-timeline-detail' },
          React.createElement('p', { className: 'ch-detail-resource' },
            selectedActivity.resources.length > 0
              ? t('resources', {
                  resources: selectedActivity.resources
                    .map(item => resourceLabel(t, item, episodeApp(selectedActivity)))
                    .join(', '),
                })
              : t('noResourceApps', {
                  apps: selectedActivity.surfaces.map(item => friendlyAppName(item.bundleId)).join(', '),
                })),
          selectedActivity.episodeCount > 1
            ? React.createElement(
                'details', { className: 'ch-inspector' },
                React.createElement('summary', null, t('activityGroupingTitle')),
                React.createElement('p', { className: 'ch-muted' },
                  t('activityGroupingBody', {
                    minutes: TIMELINE_ACTIVITY_MERGE_GAP_MS / 60_000,
                  })),
              )
            : null,
          selectedActivity.episodeCount > 1
            ? React.createElement(
                'details', { className: 'ch-inspector' },
                React.createElement('summary', null, t('rawEpisodes')),
                React.createElement(
                  'ul', { className: 'ch-segment-list' },
                  ...selectedRawEpisodes.map(episode => React.createElement(
                    'li', { key: String(episode.id) },
                    React.createElement('span', null,
                      `${formatClock(episode.startedAtMs, activeLocale)}–${formatClock(episode.endedAtMs, activeLocale)}`),
                    React.createElement('span', { className: 'ch-muted' },
                      episodeMeta(t, episode, episodeApp(episode))),
                  )),
                ),
              )
            : null,
          React.createElement(
            'details', { className: 'ch-inspector' },
            React.createElement('summary', null,
              selectedActivity.episodeCount > 1
                ? t('latestRawEpisodeWhyRecorded')
                : t('whyRecorded')),
            React.createElement('p', { className: 'ch-muted' },
              t('episodeAuditMeta', {
                citations: selected.summaryObservationIds.length,
                confidence: selected.confidence.toFixed(2),
                start: selected.boundary.startReason,
                end: selected.boundary.endReason ?? '—',
              })),
          ),
        )
}
