import React from 'react'
import type {
  EpisodeDetail,
  EpisodeSummary,
  PolicySnapshot,
  ResumeResolution,
  SemanticSummaryState,
  TimelineDay,
  WorkThread,
} from '../shared/index.js'
import { localDayKey } from '../shared/audit-view.js'
import { historyApi } from './api.js'
import {
  captureLabel,
  failureText,
  reasonText,
  type HistoryTranslate,
} from './locale.js'
import type { HistoryControlStore } from './store.js'

interface PanelFactoryOptions {
  readonly getActiveLocale: () => string
  readonly store: HistoryControlStore
}

interface PanelComponentProps {
  readonly t: HistoryTranslate
}

function section(title: string, ...children: React.ReactNode[]): React.ReactElement {
  return React.createElement(
    'section', { className: 'ch-section' },
    React.createElement('h2', { className: 'ch-section-title' }, title),
    ...children,
  )
}

function friendlyAppName(bundleId: string): string {
  const known: Record<string, string> = {
    'com.apple.Notes': 'Notes',
    'com.apple.Preview': 'Preview',
    'com.apple.Terminal': 'Terminal',
    'com.apple.finder': 'Finder',
    'com.apple.dt.Xcode': 'Xcode',
    'com.apple.Safari': 'Safari',
    'com.google.Chrome': 'Google Chrome',
    'com.microsoft.VSCode': 'VS Code',
    'com.microsoft.edgemac': 'Microsoft Edge',
    'com.openai.chat': 'ChatGPT',
  }
  if (known[bundleId]) return known[bundleId]
  const tail = bundleId.split('.').findLast(part => part.length > 0)
  return tail && tail.length <= 28 ? tail.replaceAll('-', ' ') : bundleId
}

function episodeApp(episode: Pick<EpisodeSummary, 'surfaces'>): string {
  const first = episode.surfaces[0]?.bundleId
  return first ? friendlyAppName(first) : '—'
}

function isHomeDirectoryResource(resource: { readonly kind: string; readonly canonicalUri: string } | undefined): boolean {
  return resource?.kind === 'directory'
    && /^file:\/\/\/Users\/[^/]+\/?$/.test(resource.canonicalUri)
}

function resourceLabel(
  t: HistoryTranslate,
  resource: { readonly kind: string; readonly canonicalUri: string; readonly displayLabel?: string },
  app?: string,
): string {
  if (app === 'Terminal' && isHomeDirectoryResource(resource)) return t('homeDirectory')
  return resource.displayLabel ?? resource.canonicalUri
}

function episodeSubject(t: HistoryTranslate, episode: EpisodeSummary): string {
  const workspaceTitle = episode.workspace?.title?.trim()
  if (episodeApp(episode) === 'Terminal') {
    const rootParts = episode.workspace?.root?.split('/').filter(Boolean) ?? []
    const isHomeWorkspace = rootParts.length === 2
      && rootParts[0] === 'Users'
      && rootParts[1] === workspaceTitle
    const resource = episode.lastStrongResource ?? episode.resources[0]
    if (!workspaceTitle || isHomeWorkspace) {
      return isHomeDirectoryResource(resource)
        ? t('terminalSession')
        : resource?.displayLabel ?? t('terminalSession')
    }
  }
  return workspaceTitle
    ?? episode.lastStrongResource?.displayLabel
    ?? episode.resources[0]?.displayLabel
    ?? episode.summary
}

function appMark(label: string): string {
  const known: Record<string, string> = {
    Terminal: '>_',
    'VS Code': '<>',
    Xcode: 'X',
    Finder: '◇',
    Preview: 'P',
    Notes: 'N',
    Safari: 'S',
    'Google Chrome': '◎',
    ChatGPT: '✦',
  }
  if (known[label]) return known[label]
  const match = label.trim().match(/[A-Za-z0-9]/)
  return (match?.[0] ?? '•').toUpperCase()
}

function resumeSubject(episode: EpisodeSummary): string | undefined {
  if (episodeApp(episode) === 'Terminal') return undefined
  const resource = episode.lastStrongResource?.displayLabel
    ?? episode.resources[0]?.displayLabel
  if (resource) return resource
  return episode.workspace?.title
}

function formatClock(atMs: number, locale: string): string {
  return new Intl.DateTimeFormat(locale || undefined, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(atMs))
}

function formatDuration(t: HistoryTranslate, milliseconds: number): string {
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

function formatRelativeAge(t: HistoryTranslate, atMs: number): string {
  const elapsed = Math.max(0, Date.now() - atMs)
  if (elapsed < 60_000) return t('justNow')
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return t('minutesAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('hoursAgo', { hours })
  return t('daysAgo', { days: Math.floor(hours / 24) })
}

function dayDuration(day: TimelineDay): number {
  return day.episodes.reduce(
    (total, episode) => total + Math.max(0, episode.endedAtMs - episode.startedAtMs),
    0,
  )
}

function dayLabel(t: HistoryTranslate, dayKey: string): string {
  const today = localDayKey(Date.now())
  if (dayKey === today) return t('today')
  const yesterday = localDayKey(Date.now() - 86_400_000)
  if (dayKey === yesterday) return t('yesterday')
  return dayKey
}

export function createHistoryPage({
  getActiveLocale,
  store,
}: PanelFactoryOptions): (props: PanelComponentProps) => React.ReactElement {
  return function HistoryPage({ t }: PanelComponentProps): React.ReactElement {
    const controls = React.useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    )
    const { state, policy } = controls
    const [hasAnyEpisode, setHasAnyEpisode] = React.useState<boolean | null>()
    const [threads, setThreads] = React.useState<readonly WorkThread[] | null>()
    const [resumeQuery, setResumeQuery] = React.useState('')
    const [hint, setHint] = React.useState<ResumeResolution>()
    const [semantic, setSemantic] = React.useState<SemanticSummaryState | null>()
    const [timeline, setTimeline] = React.useState<readonly TimelineDay[] | null>()
    const [selected, setSelected] = React.useState<EpisodeDetail>()
    const [preview, setPreview] = React.useState<string>()
    const [contentError, setContentError] = React.useState<string>()
    const [actionError, setActionError] = React.useState<string>()

    const refreshContent = React.useCallback(async () => {
      const results = await Promise.allSettled([
        historyApi.getRecent(1),
        historyApi.getThreads(20),
        historyApi.getSemanticState(),
        historyApi.getTimeline(7),
      ] as const)
      const [recentResult, threadResult, semanticResult, timelineResult] = results
      setHasAnyEpisode(recentResult.status === 'fulfilled'
        ? recentResult.value.length > 0
        : null)
      setThreads(threadResult.status === 'fulfilled' ? threadResult.value : null)
      setSemantic(semanticResult.status === 'fulfilled' ? semanticResult.value : null)
      setTimeline(timelineResult.status === 'fulfilled' ? timelineResult.value : null)
      const failures = results.filter(result => result.status === 'rejected')
      const failure = failures[0]
      setContentError(
        failures.length === results.length && failure?.status === 'rejected'
          ? failureText(t, failure.reason)
          : undefined,
      )
    }, [t])

    React.useEffect(() => {
      void store.load().catch(() => {})
      void refreshContent()
    }, [refreshContent, store])
    React.useEffect(() => {
      if (controls.historyRevision <= 0) return
      setSelected(undefined)
      setHint(undefined)
      setPreview(undefined)
      void refreshContent()
    }, [controls.historyRevision, refreshContent])

    const runAction = (action: () => Promise<void>): void => {
      setActionError(undefined)
      void action().catch(cause => { setActionError(failureText(t, cause)) })
    }

    const retryLoads = (): void => {
      setContentError(undefined)
      void store.reload().catch(() => {})
      void refreshContent()
    }

    const findWhereILeftOff = async (): Promise<void> => {
      setHint(await historyApi.resolveResume(resumeQuery))
    }

    const revokeScope = async (scopeKey: string): Promise<void> => {
      await historyApi.revokeSemantic(scopeKey)
      setPreview(undefined)
      setSemantic(await historyApi.getSemanticState())
    }

    const previewScope = async (scopeKey: string): Promise<void> => {
      const payload = await historyApi.previewSemantic(scopeKey)
      setPreview(`${scopeKey}\n${JSON.stringify(payload, null, 2)}`)
    }

    const openEpisode = async (id: string): Promise<void> => {
      if (String(selected?.id) === id) {
        setSelected(undefined)
        return
      }
      setSelected(await historyApi.getEpisode(id))
    }

    const startRecording = async (): Promise<void> => {
      const preset = state?.firstRunPreset
      if (!preset || !policy) return
      const existing = new Map<string, PolicySnapshot['rules'][number]>(
        policy.rules.filter(rule => !rule.builtIn).map(rule => [rule.pattern, rule]),
      )
      const now = Date.now()
      for (const bundle of preset.bundles) {
        if (existing.has(bundle)) continue
        existing.set(bundle, {
          id: (`preset:${bundle}`) as never,
          dimension: 'app', action: 'allow', matcher: 'exact', pattern: bundle,
          builtIn: false, createdAtMs: now, updatedAtMs: now,
        })
      }
      await store.replacePolicy({
        mode: 'include-only',
        rules: Array.from(existing.values()),
      })
    }

    const staleRelease = state?.release?.stale
    const staleSection = staleRelease
      ? React.createElement(
          'section', { className: 'ch-alert' },
          React.createElement('p', { role: 'status' },
            t('staleRelease', { profile: staleRelease.profile })),
          React.createElement('p', { className: 'ch-muted' }, t('staleRunCommand')),
          React.createElement('pre', { className: 'ch-code' }, staleRelease.updateCommand),
        )
      : null

    const isFirstRun =
      controls.status === 'ready'
      && hasAnyEpisode === false
      && timeline?.length === 0
      && policy !== undefined
      && policy.rules.every(rule => rule.builtIn)
    const preset = state?.firstRunPreset
    const firstRunSection = isFirstRun
      ? React.createElement(
          'section', { className: 'ch-first-run' },
          React.createElement('div', { className: 'ch-first-run-mark', 'aria-hidden': true }, '◷'),
          React.createElement('h2', null, t('startHere')),
          React.createElement('p', { className: 'ch-first-run-lead' }, t('firstRunIntro')),
          React.createElement(
            'div', { className: 'ch-first-run-points' },
            React.createElement('span', null, `✓ ${t('metadataOnly')}`),
            React.createElement('span', null, `✓ ${t('firstRunPrivacy')}`),
            React.createElement('span', null, `✓ ${t('firstRunProtected')}`),
          ),
          React.createElement(
            'div', { className: 'ch-first-run-action' },
            React.createElement('button', {
              type: 'button', className: 'ch-button', disabled: !preset,
              onClick: () => { runAction(startRecording) },
            }, t('startRecording')),
            preset
              ? React.createElement('span', { className: 'ch-muted' },
                  t('firstRunApps', { count: preset.bundles.length }))
              : null,
          ),
        )
      : null

    const activeLocale = getActiveLocale()
    const todayKey = localDayKey(Date.now())
    const todayDay = timeline && timeline !== null
      ? timeline.find(day => day.dayKey === todayKey)
      : undefined
    const todayApps = todayDay
      ? new Set(todayDay.episodes.flatMap(episode => episode.surfaces.map(surface => surface.bundleId))).size
      : 0
    const todayDuration = todayDay ? dayDuration(todayDay) : 0
    const recentEpisode = timeline && timeline !== null
      ? timeline.flatMap(day => day.episodes).find(episode => resumeSubject(episode) !== undefined)
      : undefined

    const statusDotClass = state?.capture === 'running'
      ? 'ch-status-dot ch-status-dot-success'
      : state?.capture === 'degraded' || state?.capture === 'permission-required'
        ? 'ch-status-dot ch-status-dot-warn'
        : state?.capture === 'stopped'
          ? 'ch-status-dot ch-status-dot-error'
          : 'ch-status-dot'

    const statusPrimary = state
      ? captureLabel(t, state.capture)
      : controls.status === 'error'
        ? t('stateUnavailable')
        : t('loadingHistory')

    const statusSummary = timeline === undefined
      ? t('timelineLoading')
      : timeline === null
        ? t('timelineUnavailable')
        : todayDay
          ? t('todayUsage', {
              duration: formatDuration(t, todayDuration),
              apps: todayApps,
            })
          : t('todayUsageNone')

    const timelineSection = section(
      t('timeline'),
      timeline === undefined
        ? React.createElement('p', { className: 'ch-muted', role: 'status' }, t('timelineLoading'))
        : timeline === null
          ? React.createElement(
              'div', { className: 'ch-inline-failure' },
              React.createElement('span', { className: 'ch-muted' }, t('timelineUnavailable')),
              React.createElement('button', {
                type: 'button', className: 'ch-text-action', onClick: retryLoads,
              }, t('retry')),
            )
          : timeline.length === 0
            ? React.createElement('p', { className: 'ch-muted' }, t('timelineEmpty'))
            : React.createElement(
                'div', { className: 'ch-timeline-shell' },
                ...timeline.map((day, dayIndex) => React.createElement(
                  'details', {
                    key: day.dayKey,
                    className: 'ch-day',
                    open: dayIndex === 0 ? true : undefined,
                  },
                  React.createElement(
                    'summary', { className: 'ch-day-summary' },
                    React.createElement('span', { className: 'ch-day-title' }, dayLabel(t, day.dayKey)),
                    React.createElement('span', { className: 'ch-day-date' }, day.dayKey),
                    React.createElement('span', { className: 'ch-day-total' },
                      t('daySummary', {
                        duration: formatDuration(t, dayDuration(day)),
                        count: day.episodeCount,
                      })),
                    React.createElement('span', { className: 'ch-day-chevron', 'aria-hidden': true }, '⌄'),
                  ),
                  React.createElement(
                    'ul', { className: 'ch-timeline-list' },
                    ...day.episodes.map(item => {
                      const app = episodeApp(item)
                      return React.createElement(
                        'li', { key: String(item.id), className: 'ch-timeline-item' },
                        React.createElement('span', { className: 'ch-time' },
                          `${formatClock(item.startedAtMs, activeLocale)}–${formatClock(item.endedAtMs, activeLocale)}`),
                        React.createElement(
                          'button', {
                            type: 'button',
                            className: String(selected?.id) === String(item.id)
                              ? 'ch-timeline-action ch-timeline-action-selected'
                              : 'ch-timeline-action',
                            'aria-expanded': String(selected?.id) === String(item.id),
                            onClick: () => { runAction(() => openEpisode(String(item.id))) },
                          },
                          React.createElement('span', { className: 'ch-app-mark', 'aria-hidden': true }, appMark(app)),
                          React.createElement(
                            'span', { className: 'ch-episode-copy' },
                            React.createElement('span', { className: 'ch-episode-title' }, episodeSubject(t, item)),
                            React.createElement('span', { className: 'ch-episode-meta' }, app),
                          ),
                        ),
                        React.createElement('span', { className: 'ch-duration' },
                          formatDuration(t, item.endedAtMs - item.startedAtMs)),
                      )
                    }),
                  ),
                )),
              ),
      selected
        ? React.createElement(
            'div', { className: 'ch-detail' },
            React.createElement(
              'div', { className: 'ch-detail-head' },
              React.createElement('span', { className: 'ch-app-mark', 'aria-hidden': true },
                appMark(episodeApp(selected))),
              React.createElement(
                'span', { className: 'ch-detail-copy' },
                React.createElement('span', { className: 'ch-detail-title' }, episodeSubject(t, selected)),
                React.createElement('span', { className: 'ch-detail-meta' },
                  `${episodeApp(selected)} · ${formatClock(selected.startedAtMs, activeLocale)}–${formatClock(selected.endedAtMs, activeLocale)} · ${formatDuration(t, selected.endedAtMs - selected.startedAtMs)}`),
              ),
            ),
            React.createElement('p', { className: 'ch-detail-resource' },
              selected.resources.length > 0
                ? t('resources', {
                    resources: selected.resources
                      .map(item => resourceLabel(t, item, episodeApp(selected)))
                      .join(', '),
                  })
                : t('noResourceApps', {
                    apps: selected.surfaces.map(item => friendlyAppName(item.bundleId)).join(', '),
                  })),
            React.createElement(
              'details', { className: 'ch-inspector' },
              React.createElement('summary', null, t('whyRecorded')),
              React.createElement('p', { className: 'ch-muted' },
                t('episodeAuditMeta', {
                  citations: selected.summaryObservationIds.length,
                  confidence: selected.confidence.toFixed(2),
                  start: selected.boundary.startReason,
                  end: selected.boundary.endReason ?? '—',
                })),
            ),
          )
        : null,
    )

    const resumeText = hint
      ? hint.status === 'hit'
        ? t('resumeHit', {
            title: hint.episode.workspace?.title ?? hint.episode.id,
            resource: hint.resource?.displayLabel ?? hint.resource?.canonicalUri ?? t('lastActivity'),
            citations: hint.citations.length,
            confidence: hint.confidence.toFixed(2),
          })
        : hint.status === 'ambiguous'
          ? t('resumeAmbiguous', { reason: hint.reason })
          : t('resumeNone', { reason: hint.reason })
      : undefined

    const resumeControls = React.createElement('div', { className: 'ch-resume-controls' },
      React.createElement('input', {
        type: 'text',
        className: 'ch-input',
        'aria-label': t('resumeAria'),
        placeholder: t('resumePlaceholder'),
        value: resumeQuery,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          setResumeQuery(event.target.value)
        },
      }),
      React.createElement('button', {
        type: 'button', className: 'ch-button',
        disabled: resumeQuery.trim().length === 0,
        onClick: () => { runAction(findWhereILeftOff) },
      }, t('resumeFind')),
    )

    const resumeSection = section(
      t('resume'),
      React.createElement(
        'div', { className: 'ch-resume-card' },
        recentEpisode
          ? React.createElement(
              'div', { className: 'ch-resume-suggestion' },
              React.createElement('span', { className: 'ch-app-mark', 'aria-hidden': true },
                appMark(episodeApp(recentEpisode))),
              React.createElement(
                'span', { className: 'ch-resume-copy' },
                React.createElement('span', { className: 'ch-resume-title' }, resumeSubject(recentEpisode) ?? episodeSubject(t, recentEpisode)),
                React.createElement('span', { className: 'ch-resume-meta' },
                  t('resumeRecentMeta', {
                    when: formatRelativeAge(t, recentEpisode.endedAtMs),
                    app: episodeApp(recentEpisode),
                  })),
              ),
            )
          : null,
        recentEpisode
          ? React.createElement(
              'details', { className: 'ch-resume-search' },
              React.createElement('summary', null, t('findAnotherWork')),
              resumeControls,
            )
          : resumeControls,
        resumeText
          ? React.createElement('p', { className: 'ch-row-body', role: 'status' }, resumeText)
          : null,
      ),
    )

    const threadSection = section(
      t('workThreads'),
      threads === undefined
        ? React.createElement('p', { className: 'ch-muted', role: 'status' }, t('workThreadsLoading'))
        : threads === null
          ? React.createElement(
              'div', { className: 'ch-inline-failure' },
              React.createElement('span', { className: 'ch-muted' }, t('workThreadsUnavailable')),
              React.createElement('button', {
                type: 'button', className: 'ch-text-action', onClick: retryLoads,
              }, t('retry')),
            )
          : threads.length === 0
            ? React.createElement('p', { className: 'ch-muted' }, t('workThreadsEmpty'))
            : React.createElement(
                'ul', { className: 'ch-thread-list' },
                ...threads.slice(0, 6).map(thread => {
                  const title = thread.workspaceTitle ?? t('unnamedWorkspace')
                  const resources = thread.resources
                    .slice(0, 2)
                    .map(resource => resource.displayLabel ?? resource.canonicalUri)
                    .join(', ')
                  return React.createElement(
                    'li', { key: thread.threadKey, className: 'ch-thread-item' },
                    React.createElement(
                      'span', { className: 'ch-thread-leading' },
                      React.createElement('span', { className: 'ch-app-mark', 'aria-hidden': true }, appMark(title)),
                      React.createElement(
                        'span', { className: 'ch-thread-copy' },
                        React.createElement('span', { className: 'ch-thread-title' }, title),
                        resources
                          ? React.createElement('span', { className: 'ch-thread-resources' }, resources)
                          : null,
                      ),
                    ),
                    React.createElement('span', { className: 'ch-thread-meta' },
                      t('threadMeta', {
                        episodes: thread.episodeCount,
                        duration: formatDuration(t, thread.endedAtMs - thread.startedAtMs),
                      })),
                  )
                }),
              ),
    )

    const summaryStatus = semantic === undefined
      ? t('summaryLoading')
      : semantic === null
        ? t('summaryUnavailable')
        : semantic.scopes.some(scope => scope.providerKind === 'remote')
          ? t('summaryRemoteShort')
          : t('summaryLocalShort')

    const semanticSection = React.createElement(
      'details', { className: 'ch-summary-disclosure' },
      React.createElement(
        'summary', null,
        React.createElement('span', null, t('summaries')),
        React.createElement('span', { className: 'ch-summary-status' }, summaryStatus),
        React.createElement('span', { className: 'ch-summary-chevron', 'aria-hidden': true }, '›'),
      ),
      React.createElement(
        'div', { className: 'ch-summary-body' },
        semantic && semantic.scopes.length
          ? React.createElement(
              'ul', { className: 'ch-summary-list' },
              ...semantic.scopes.map(scope => React.createElement(
                'li', { key: scope.scopeKey, className: 'ch-summary-item' },
                React.createElement('div', { className: 'ch-summary-item-title' },
                  `${scope.scopeKey} — ${scope.providerKind}${scope.model ? ` (${scope.model})` : ''}`),
                React.createElement('div', { className: 'ch-controls' },
                  React.createElement('button', {
                    type: 'button', className: 'ch-button',
                    onClick: () => { runAction(() => previewScope(scope.scopeKey)) },
                  }, t('previewPayload')),
                  React.createElement('button', {
                    type: 'button', className: 'ch-button ch-button-danger',
                    onClick: () => { runAction(() => revokeScope(scope.scopeKey)) },
                  }, t('turnOffPurge')),
                ),
              )),
            )
          : semantic === undefined || semantic === null
            ? null
            : React.createElement('p', { className: 'ch-muted' }, t('noModelScope')),
        preview ? React.createElement('pre', { className: 'ch-code' }, preview) : null,
      ),
    )

    return React.createElement(
      'main',
      { className: 'ch-main' },
      React.createElement(
        'header', { className: 'ch-main-header' },
        React.createElement(
          'div', { className: 'ch-heading' },
          React.createElement('h1', null, t('title')),
          React.createElement('p', { className: 'ch-subtitle' }, t('subtitleProduct')),
        ),
        React.createElement(
          'div', { className: 'ch-status-card', role: 'status' },
          React.createElement('span', { className: statusDotClass, 'aria-hidden': true }),
          React.createElement('span', { className: 'ch-status-primary' }, statusPrimary),
          React.createElement('span', { className: 'ch-status-meta' }, t('metadataOnly')),
          React.createElement('span', { className: 'ch-status-summary' }, statusSummary),
        ),
      ),
      staleSection,
      state?.reason
        ? React.createElement('div', { className: 'ch-alert' },
            React.createElement('p', null, reasonText(t, state.reason)))
        : null,
      (controls.status === 'error' && controls.error) || contentError
        ? React.createElement(
            'div', { className: 'ch-alert' },
            React.createElement('p', { role: 'alert' }, failureText(t, controls.error ?? contentError)),
            React.createElement('div', { className: 'ch-controls' },
              React.createElement('button', {
                type: 'button', className: 'ch-button', onClick: retryLoads,
              }, t('retry')),
            ),
          )
        : null,
      actionError
        ? React.createElement('div', { className: 'ch-alert', role: 'alert' }, actionError)
        : null,
      isFirstRun ? firstRunSection : timelineSection,
      !isFirstRun && timeline && timeline.length > 0 ? resumeSection : null,
      !isFirstRun ? threadSection : null,
      !isFirstRun ? semanticSection : null,
    )
  }
}
