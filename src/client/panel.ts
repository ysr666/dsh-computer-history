import React from 'react'
import type {
  EpisodeDetail,
  EpisodeSummary,
  PolicySnapshot,
  ResumeOpenCapability,
  ResumeResolution,
  SemanticSummaryState,
  TimelineActivity,
  TimelineDay,
  WorkThread,
  WorkThreadDetail,
} from '../shared/index.js'
import { localDayKey, TIMELINE_ACTIVITY_MERGE_GAP_MS } from '../shared/audit-view.js'
import { historyApi } from './api.js'
import {
  episodeApp,
  episodeSubject,
  friendlyAppName,
  isHomeDirectoryResource,
} from './episode-subject.js'
import {
  captureLabel,
  failureText,
  reasonText,
  type HistoryTranslate,
} from './locale.js'
import type { HistoryControlStore } from './store.js'
import {
  firstRunBundles,
  setupStage,
  shouldOfferAllowedAppsRecovery,
  type SetupStage,
} from './setup-state.js'

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

function skeletonLine(className = ''): React.ReactElement {
  return React.createElement('span', {
    className: `ch-skeleton-line${className ? ` ${className}` : ''}`,
  })
}

function timelineSkeleton(label: string): React.ReactElement {
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

function threadSkeleton(label: string): React.ReactElement {
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

function appMark(label: string): string {
  const known: Record<string, string> = {
    Terminal: '>_',
    'VS Code': 'VS',
    Xcode: 'X',
    Finder: 'F',
    Preview: 'P',
    Notes: 'N',
    Safari: 'S',
    'Google Chrome': 'GC',
    'Microsoft Edge': 'E',
    ChatGPT: '✦',
  }
  if (known[label]) return known[label]
  const parts = label.trim().split(/\s+/).filter(Boolean)
  const initials = parts.slice(0, 2).map(part => part[0]).join('')
  return (initials || '•').toUpperCase()
}

function appBadge(app: string): React.ReactElement {
  return React.createElement(
    'span',
    { className: 'ch-app-mark', 'aria-hidden': true, title: app },
    appMark(app),
  )
}

function resourceLabel(
  t: HistoryTranslate,
  resource: { readonly kind: string; readonly canonicalUri: string; readonly displayLabel?: string },
  app?: string,
): string {
  if (app === 'Terminal' && isHomeDirectoryResource(resource)) return t('homeDirectory')
  return resource.displayLabel ?? resource.canonicalUri
}

function episodeMeta(
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

function resumeResourceUri(episode: EpisodeSummary): string | undefined {
  return (episode.lastStrongResource ?? episode.resources[0])?.canonicalUri
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

function activityDisplayDuration(activity: TimelineActivity): number {
  return activity.episodeCount > 1
    ? activity.spanDurationMs
    : activity.observedDurationMs
}

function activityDurationText(t: HistoryTranslate, activity: TimelineActivity): string {
  const duration = formatDuration(t, activityDisplayDuration(activity))
  return activity.episodeCount > 1
    ? t('approxDuration', { duration })
    : duration
}

function dayDuration(day: TimelineDay): number {
  return day.activities.reduce(
    (total, activity) => total + activityDisplayDuration(activity),
    0,
  )
}

export type SummaryDisplayStatus =
  | 'loading'
  | 'unavailable'
  | 'deterministic'
  | 'local'
  | 'remote'

export function summaryDisplayStatus(
  semantic: SemanticSummaryState | null | undefined,
): SummaryDisplayStatus {
  if (semantic === undefined) return 'loading'
  if (semantic === null) return 'unavailable'
  if (semantic.scopes.some(scope => scope.providerKind === 'remote')) return 'remote'
  if (semantic.scopes.some(scope => scope.providerKind === 'local')) return 'local'
  return 'deterministic'
}

export interface LatestRequestGate {
  begin(): number
  isCurrent(request: number): boolean
  invalidate(): void
}

export function createLatestRequestGate(): LatestRequestGate {
  let current = 0
  return {
    begin() {
      current += 1
      return current
    },
    isCurrent(request) {
      return request === current
    },
    invalidate() {
      current += 1
    },
  }
}

function dayLabel(t: HistoryTranslate, dayKey: string): string {
  const today = localDayKey(Date.now())
  if (dayKey === today) return t('today')
  const yesterday = localDayKey(Date.now() - 86_400_000)
  if (dayKey === yesterday) return t('yesterday')
  return dayKey
}

function formatDayDate(dayKey: string, locale: string): string {
  const date = new Date(`${dayKey}T12:00:00`)
  const dateText = new Intl.DateTimeFormat(locale || undefined, {
    month: 'short', day: 'numeric',
  }).format(date)
  const weekday = new Intl.DateTimeFormat(locale || undefined, {
    weekday: 'short',
  }).format(date)
  return `${dateText} · ${weekday}`
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
    const [latestEpisode, setLatestEpisode] = React.useState<EpisodeSummary | null>()
    const [accessibilitySettingsAvailable, setAccessibilitySettingsAvailable] = React.useState(false)
    const [awaitingAccessibility, setAwaitingAccessibility] = React.useState(false)
    const [threads, setThreads] = React.useState<readonly WorkThread[] | null>()
    const [threadDetail, setThreadDetail] = React.useState<WorkThreadDetail>()
    const [threadDetailPendingKey, setThreadDetailPendingKey] = React.useState<string>()
    const [threadDetailError, setThreadDetailError] = React.useState<string>()
    const [resumeQuery, setResumeQuery] = React.useState('')
    const [hint, setHint] = React.useState<ResumeResolution>()
    const [resumeOpenCapability, setResumeOpenCapability] = React.useState<ResumeOpenCapability>()
    const [resumeOpenPending, setResumeOpenPending] = React.useState(false)
    const [semantic, setSemantic] = React.useState<SemanticSummaryState | null>()
    const [timeline, setTimeline] = React.useState<readonly TimelineDay[] | null>()
    const [timelineDays, setTimelineDays] = React.useState(7)
    const [timelineHasMore, setTimelineHasMore] = React.useState(false)
    const [timelineMorePending, setTimelineMorePending] = React.useState(false)
    const [selected, setSelected] = React.useState<EpisodeDetail>()
    const [selectedActivity, setSelectedActivity] = React.useState<TimelineActivity>()
    const [preview, setPreview] = React.useState<string>()
    const [contentError, setContentError] = React.useState<string>()
    const [actionError, setActionError] = React.useState<string>()
    const [captureRecoveryPending, setCaptureRecoveryPending] = React.useState(false)
    const [startRecordingPending, setStartRecordingPending] = React.useState(false)
    const contentRequests = React.useRef(createLatestRequestGate())
    const timelineRequests = React.useRef(createLatestRequestGate())
    const activityRequests = React.useRef(createLatestRequestGate())
    const threadRequests = React.useRef(createLatestRequestGate())
    const previewRequests = React.useRef(createLatestRequestGate())
    const hintRequests = React.useRef(createLatestRequestGate())

    const refreshContent = React.useCallback(async () => {
      const request = contentRequests.current.begin()
      const timelineRequest = timelineRequests.current.begin()
      setTimelineMorePending(false)
      const results = await Promise.allSettled([
        historyApi.getRecent(1),
        historyApi.getThreads(20),
        historyApi.getSemanticState(),
        historyApi.getTimeline(8),
      ] as const)
      const [recentResult, threadResult, semanticResult, timelineResult] = results
      if (!contentRequests.current.isCurrent(request)) return
      setHasAnyEpisode(recentResult.status === 'fulfilled'
        ? recentResult.value.length > 0
        : null)
      setLatestEpisode(recentResult.status === 'fulfilled'
        ? recentResult.value[0] ?? null
        : null)
      setThreads(threadResult.status === 'fulfilled' ? threadResult.value : null)
      setSemantic(semanticResult.status === 'fulfilled' ? semanticResult.value : null)
      if (timelineRequests.current.isCurrent(timelineRequest)) {
        if (timelineResult.status === 'fulfilled') {
          setTimelineDays(7)
          setTimelineHasMore(timelineResult.value.length > 7)
          setTimeline(timelineResult.value.slice(0, 7))
        } else {
          setTimelineHasMore(false)
          setTimeline(null)
        }
      }
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
      void historyApi.getResumeOpenCapability()
        .then(setResumeOpenCapability)
        .catch(() => {
          setResumeOpenCapability({
            available: false,
            reason: 'opener-unavailable',
          })
        })
      void historyApi.getAccessibilitySettingsCapability()
        .then(capability => { setAccessibilitySettingsAvailable(capability.available) })
        .catch(() => { setAccessibilitySettingsAvailable(false) })
    }, [refreshContent, store])
    React.useEffect(() => {
      if (!awaitingAccessibility) return
      const refreshOnReturn = (): void => {
        setAwaitingAccessibility(false)
        void store.reload().catch(() => {})
      }
      window.addEventListener('focus', refreshOnReturn, { once: true })
      return () => { window.removeEventListener('focus', refreshOnReturn) }
    }, [awaitingAccessibility, store])
    React.useEffect(() => {
      if (controls.historyRevision <= 0) return
      activityRequests.current.invalidate()
      threadRequests.current.invalidate()
      previewRequests.current.invalidate()
      hintRequests.current.invalidate()
      setSelected(undefined)
      setSelectedActivity(undefined)
      setThreadDetail(undefined)
      setThreadDetailPendingKey(undefined)
      setThreadDetailError(undefined)
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

    const recoverCapture = async (): Promise<void> => {
      setCaptureRecoveryPending(true)
      try {
        await store.recover()
      } finally {
        setCaptureRecoveryPending(false)
      }
    }

    const openAccessibilitySettings = async (): Promise<void> => {
      setActionError(undefined)
      const result = await historyApi.openAccessibilitySettings()
      if (result.status !== 'opened') {
        setActionError(t('accessibilitySettingsUnavailable'))
        return
      }
      setAwaitingAccessibility(true)
    }

    const showEarlierHistory = async (): Promise<void> => {
      const request = timelineRequests.current.begin()
      const nextDays = timelineDays + 7
      setTimelineMorePending(true)
      setActionError(undefined)
      try {
        const next = await historyApi.getTimeline(nextDays + 1)
        if (!timelineRequests.current.isCurrent(request)) return
        setTimelineDays(nextDays)
        setTimelineHasMore(next.length > nextDays)
        setTimeline(next.slice(0, nextDays))
      } catch (cause) {
        if (timelineRequests.current.isCurrent(request)) {
          setActionError(failureText(t, cause))
        }
      } finally {
        if (timelineRequests.current.isCurrent(request)) {
          setTimelineMorePending(false)
        }
      }
    }

    const findWhereILeftOff = async (): Promise<void> => {
      const request = hintRequests.current.begin()
      const result = await historyApi.resolveResume(resumeQuery)
      if (hintRequests.current.isCurrent(request)) setHint(result)
    }

    const continueRecordedWork = async (
      episode: EpisodeSummary,
      resourceCanonicalUri?: string,
    ): Promise<void> => {
      setActionError(undefined)
      setResumeOpenPending(true)
      try {
        const result = await historyApi.openResume({
          episodeId: episode.id,
          ...(resourceCanonicalUri === undefined
            ? {}
            : { resourceCanonicalUri }),
        })
        if (result.status === 'unsupported') {
          setActionError(t(
            result.reason === 'resource-missing'
              ? 'resumeOpenMissing'
              : 'resumeOpenUnavailable',
          ))
        }
      } catch {
        setActionError(t('resumeOpenFailed'))
      } finally {
        setResumeOpenPending(false)
      }
    }

    const revokeScope = async (scopeKey: string): Promise<void> => {
      previewRequests.current.invalidate()
      await store.revokeSemantic(scopeKey)
      setPreview(undefined)
      // Semantic purge changes Episode summaries. historyRevision invalidates
      // any old detail/timeline/thread requests and refreshes all projections
      // together, instead of updating only the semantic toggle row here.
    }

    const previewScope = async (scopeKey: string): Promise<void> => {
      const request = previewRequests.current.begin()
      const payload = await historyApi.previewSemantic(scopeKey)
      if (previewRequests.current.isCurrent(request)) {
        setPreview(JSON.stringify(payload, null, 2))
      }
    }

    const openActivity = async (activity: TimelineActivity): Promise<void> => {
      if (selectedActivity?.activityKey === activity.activityKey) {
        activityRequests.current.invalidate()
        setSelected(undefined)
        setSelectedActivity(undefined)
        return
      }
      const request = activityRequests.current.begin()
      const detail = await historyApi.getEpisode(String(activity.representativeEpisodeId))
      if (!activityRequests.current.isCurrent(request)) return
      setSelectedActivity(activity)
      setSelected(detail)
    }

    const openThread = async (thread: WorkThread): Promise<void> => {
      if (threadDetail?.thread.threadKey === thread.threadKey) {
        threadRequests.current.invalidate()
        setThreadDetail(undefined)
        setThreadDetailPendingKey(undefined)
        setThreadDetailError(undefined)
        return
      }
      const request = threadRequests.current.begin()
      setThreadDetailPendingKey(thread.threadKey)
      setThreadDetailError(undefined)
      try {
        const detail = await historyApi.getThread(thread.threadKey)
        if (!threadRequests.current.isCurrent(request)) return
        setThreadDetail(detail)
      } catch (cause) {
        if (!threadRequests.current.isCurrent(request)) return
        setThreadDetail(undefined)
        setThreadDetailError(failureText(t, cause))
      } finally {
        if (threadRequests.current.isCurrent(request)) {
          setThreadDetailPendingKey(undefined)
        }
      }
    }

    const startRecording = async (): Promise<void> => {
      const preset = state?.firstRunPreset
      if (!preset || !policy) return
      setStartRecordingPending(true)
      try {
        const existing = new Map<string, PolicySnapshot['rules'][number]>(
          policy.rules.filter(rule => !rule.builtIn).map(rule => [rule.pattern, rule]),
        )
        let inventory
        try {
          inventory = await historyApi.getSupportedApplications()
        } catch {
          // Inventory narrows first-run consent. If it is unavailable, preserve
          // the existing preset instead of guessing from bundle-id spelling.
        }
        const bundles = firstRunBundles(preset.bundles, inventory)
        const now = Date.now()
        for (const bundle of bundles) {
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
        if (state.capture === 'paused') await store.resume()
        if (!state.accessibilityTrusted && accessibilitySettingsAvailable) {
          await openAccessibilitySettings()
        }
      } finally {
        setStartRecordingPending(false)
      }
    }

    const staleRelease = state?.release?.stale
    const staleSection = staleRelease
      ? React.createElement(
          'section', { className: 'ch-alert' },
          React.createElement('p', { role: 'status' }, t('staleRelease')),
          React.createElement(
            'details', { className: 'ch-inspector' },
            React.createElement('summary', null, t('staleAdvanced')),
            React.createElement('p', { className: 'ch-muted' }, t('staleRunCommand')),
            React.createElement('pre', { className: 'ch-code' }, staleRelease.updateCommand),
          ),
        )
      : null
    const maintenanceSection = state?.maintenance?.retention === 'failed'
      ? React.createElement(
          'section', { className: 'ch-alert' },
          React.createElement('p', { role: 'status' }, t('maintenanceWarning')),
        )
      : null

    const setup: SetupStage | undefined =
      controls.status === 'ready'
      && state !== undefined
      && policy !== undefined
      && typeof hasAnyEpisode === 'boolean'
        ? setupStage({
            state,
            policy,
            hasAnyEpisode,
            ...(latestEpisode?.endedAtMs === undefined
              ? {}
              : { newestEpisodeAtMs: latestEpisode.endedAtMs }),
          })
        : undefined
    const isFirstRun = setup !== undefined
      && setup !== 'complete'
      && timeline?.length === 0
    const preset = state?.firstRunPreset
    const setupCopy = setup === 'permission'
      ? { title: t('setupPermissionTitle'), lead: t('setupPermissionBody') }
      : setup === 'paused'
        ? { title: t('setupPausedTitle'), lead: t('setupPausedBody') }
        : setup === 'waiting'
          ? { title: t('setupWaitingTitle'), lead: t('setupWaitingBody') }
          : setup === 'stopped'
            ? { title: t('setupBlockedTitle'), lead: t('setupStoppedBody') }
            : setup === 'degraded'
              ? { title: t('setupBlockedTitle'), lead: t('setupDegradedBody') }
              : { title: t('startHere'), lead: t('firstRunIntro') }
    const setupAction = setup === 'choose-apps'
      ? React.createElement('button', {
          type: 'button', className: 'ch-button', disabled: !preset || startRecordingPending,
          onClick: () => { runAction(startRecording) },
        }, t(!state?.accessibilityTrusted && accessibilitySettingsAvailable
          ? 'startAndAuthorize'
          : 'startRecording'))
      : setup === 'permission' && accessibilitySettingsAvailable
        ? React.createElement('button', {
            type: 'button', className: 'ch-button', disabled: awaitingAccessibility,
            onClick: () => { runAction(openAccessibilitySettings) },
          }, awaitingAccessibility ? t('waitingForPermission') : t('openSystemSettings'))
        : setup === 'paused'
          ? React.createElement('button', {
              type: 'button', className: 'ch-button',
              onClick: () => { runAction(async () => { await store.resume() }) },
            }, t('resumeRecording'))
          : setup === 'stopped' || setup === 'degraded'
            ? React.createElement('button', {
                type: 'button', className: 'ch-button', disabled: captureRecoveryPending,
                onClick: () => { runAction(recoverCapture) },
              }, t(captureRecoveryPending ? 'recoveringRecording' : 'retryRecording'))
            : null
    const firstRunSection = isFirstRun
      ? React.createElement(
          'section', { className: 'ch-first-run' },
          React.createElement('div', { className: 'ch-first-run-mark', 'aria-hidden': true }, '◷'),
          React.createElement('h2', null, setupCopy.title),
          React.createElement('p', { className: 'ch-first-run-lead' }, setupCopy.lead),
          React.createElement(
            'div', { className: 'ch-first-run-points' },
            React.createElement('span', null, `✓ ${t('metadataOnly')}`),
            React.createElement('span', null, `✓ ${t('firstRunPrivacy')}`),
            React.createElement('span', null, `✓ ${t('firstRunProtected')}`),
          ),
          setupAction
            ? React.createElement(
                'div', { className: 'ch-first-run-action' },
                setupAction,
                setup === 'choose-apps' && preset
                  ? React.createElement('span', { className: 'ch-muted' },
                      t('firstRunApps'))
                  : null,
              )
            : state?.reason
              ? React.createElement('p', { className: 'ch-muted' }, reasonText(t, state.reason))
              : null,
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
    const todayDurationText = todayDay && todayDay.activities.some(activity => activity.episodeCount > 1)
      ? t('approxDuration', { duration: formatDuration(t, todayDuration) })
      : formatDuration(t, todayDuration)
    const recentEpisode = timeline && timeline !== null
      ? timeline.flatMap(day => day.episodes).find(episode => resumeSubject(episode) !== undefined)
      : undefined
    const selectedRawEpisodes = selectedActivity && timeline
      ? (() => {
          const ids = new Set(selectedActivity.episodeIds.map(String))
          return timeline
            .flatMap(day => day.episodes)
            .filter(episode => ids.has(String(episode.id)))
            .toSorted((a, b) => a.startedAtMs - b.startedAtMs)
        })()
      : []

    const statusDotClass = setup === 'choose-apps'
      ? 'ch-status-dot'
      : state?.capture === 'running'
        ? 'ch-status-dot ch-status-dot-success'
        : state?.capture === 'degraded' || state?.capture === 'permission-required'
          ? 'ch-status-dot ch-status-dot-warn'
          : state?.capture === 'stopped'
            ? 'ch-status-dot ch-status-dot-error'
            : 'ch-status-dot'

    const statusPrimary = setup === 'choose-apps'
      ? t('captureNotStarted')
      : state
        ? captureLabel(t, state.capture)
        : controls.status === 'error'
          ? t('stateUnavailable')
          : t('loadingHistory')

    const statusSummary = setup === 'choose-apps'
      ? t('readyToStart')
      : setup === 'permission'
        ? t('setupPermissionSummary')
        : setup === 'paused'
          ? t('setupPausedSummary')
          : setup === 'waiting'
            ? t('setupWaitingSummary')
            : timeline === undefined
              ? t('timelineLoading')
              : timeline === null
                ? t('timelineUnavailable')
                : todayDay
                  ? t('todayUsage', {
                      duration: todayDurationText,
                      apps: todayApps,
                    })
                  : t('todayUsageNone')

    const timelineSection = section(
      t('timeline'),
      timeline === undefined
        ? timelineSkeleton(t('timelineLoading'))
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
                ...timeline.map((day, dayIndex) => {
                  const duration = formatDuration(t, dayDuration(day))
                  const displayDuration = day.activities.some(activity => activity.episodeCount > 1)
                    ? t('approxDuration', { duration })
                    : duration
                  return React.createElement(
                    'details', {
                      key: day.dayKey,
                      className: 'ch-day',
                      open: dayIndex === 0 ? true : undefined,
                    },
                    React.createElement(
                      'summary', { className: 'ch-day-summary' },
                      React.createElement('span', { className: 'ch-day-title' }, dayLabel(t, day.dayKey)),
                      React.createElement('span', { className: 'ch-day-date' }, formatDayDate(day.dayKey, activeLocale)),
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
                            `${formatClock(activity.startedAtMs, activeLocale)}–${formatClock(activity.endedAtMs, activeLocale)}`),
                          React.createElement(
                            'button', {
                              type: 'button',
                              className: isSelected
                                ? 'ch-timeline-action ch-timeline-action-selected'
                                : 'ch-timeline-action',
                              'aria-expanded': isSelected,
                              onClick: () => { runAction(() => openActivity(activity)) },
                            },
                            appBadge(app),
                            React.createElement(
                              'span', { className: 'ch-episode-copy' },
                              React.createElement('span', { className: 'ch-episode-title' }, episodeSubject(t, activity)),
                              React.createElement('span', { className: 'ch-episode-meta' }, episodeMeta(t, activity, app)),
                            ),
                          ),
                          React.createElement('span', { className: 'ch-duration' },
                            activityDurationText(t, activity)),
                        )
                      }),
                    ),
                  )
                }),
              ),
      timelineHasMore
        ? React.createElement(
            'div', { className: 'ch-timeline-more' },
            React.createElement('button', {
              type: 'button',
              className: 'ch-text-action',
              disabled: timelineMorePending,
              onClick: () => { void showEarlierHistory() },
            }, timelineMorePending ? t('loadingEarlierHistory') : t('showEarlierHistory')),
          )
        : null,
      selectedActivity && selected
        ? React.createElement(
            'div', { className: 'ch-detail' },
            React.createElement(
              'div', { className: 'ch-detail-head' },
              appBadge(episodeApp(selectedActivity)),
              React.createElement(
                'span', { className: 'ch-detail-copy' },
                React.createElement('span', { className: 'ch-detail-title' }, episodeSubject(t, selectedActivity)),
                React.createElement('span', { className: 'ch-detail-meta' },
                  `${episodeApp(selectedActivity)} · ${formatClock(selectedActivity.startedAtMs, activeLocale)}–${formatClock(selectedActivity.endedAtMs, activeLocale)} · ${activityDurationText(t, selectedActivity)}`),
              ),
            ),
            selectedActivity.episodeCount > 1
              ? React.createElement('p', { className: 'ch-detail-resource' },
                  t('mergedActivity', { count: selectedActivity.episodeCount }))
              : null,
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
        : null,
    )

    const resumeText = hint
      ? hint.status === 'hit'
        ? t('resumeHit', {
            title: hint.episode.workspace?.title ?? hint.episode.id,
            resource: hint.resource?.displayLabel ?? hint.resource?.canonicalUri ?? t('lastActivity'),
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
          hintRequests.current.invalidate()
          setHint(undefined)
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
              appBadge(episodeApp(recentEpisode)),
              React.createElement(
                'span', { className: 'ch-resume-copy' },
                React.createElement('span', { className: 'ch-resume-title' }, resumeSubject(recentEpisode) ?? episodeSubject(t, recentEpisode)),
                React.createElement('span', { className: 'ch-resume-meta' },
                  t('resumeRecentMeta', {
                    when: formatRelativeAge(t, recentEpisode.endedAtMs),
                    app: episodeApp(recentEpisode),
                  })),
              ),
              resumeOpenCapability?.available
                ? React.createElement('button', {
                    type: 'button',
                    className: 'ch-button ch-resume-open',
                    disabled: resumeOpenPending,
                    onClick: () => {
                      void continueRecordedWork(
                        recentEpisode,
                        resumeResourceUri(recentEpisode),
                      )
                    },
                  }, resumeOpenPending ? t('openingWork') : t('continueWork'))
                : null,
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
          ? React.createElement(
              'div', { className: 'ch-resume-result', role: 'status' },
              React.createElement('p', { className: 'ch-row-body' }, resumeText),
              hint?.status === 'hit' && resumeOpenCapability?.available
                ? React.createElement('button', {
                    type: 'button',
                    className: 'ch-button',
                    disabled: resumeOpenPending,
                    onClick: () => {
                      void continueRecordedWork(
                        hint.episode,
                        hint.resource?.canonicalUri,
                      )
                    },
                  }, resumeOpenPending ? t('openingWork') : t('continueWork'))
                : null,
            )
          : null,
      ),
    )

    const threadDetailView = threadDetail
      ? (() => {
          const activityCount = threadDetail.timeline.reduce(
            (total, day) => total + day.activityCount,
            0,
          )
          const durationMs = threadDetail.timeline.reduce(
            (total, day) => total + dayDuration(day),
            0,
          )
          const hasMergedActivity = threadDetail.timeline.some(day =>
            day.activities.some(activity => activity.episodeCount > 1),
          )
          const durationText = formatDuration(t, durationMs)
          const displayDuration = hasMergedActivity
            ? t('approxDuration', { duration: durationText })
            : durationText
          const title = threadDetail.thread.workspaceTitle ?? t('unnamedWorkspace')
          return React.createElement(
            'div', { className: 'ch-project-history' },
            React.createElement(
              'div', { className: 'ch-project-history-head' },
              React.createElement(
                'div', null,
                React.createElement('span', { className: 'ch-project-history-kicker' }, t('projectHistory')),
                React.createElement('h3', null, title),
                React.createElement('p', { className: 'ch-muted' },
                  t('projectHistoryMeta', {
                    activities: activityCount,
                    days: threadDetail.timeline.length,
                    duration: displayDuration,
                  })),
              ),
              React.createElement('button', {
                type: 'button',
                className: 'ch-text-action',
                'aria-label': t('closeProjectHistory'),
                onClick: () => {
                  threadRequests.current.invalidate()
                  setThreadDetail(undefined)
                  setThreadDetailPendingKey(undefined)
                },
              }, '×'),
            ),
            React.createElement(
              'div', { className: 'ch-project-days' },
              ...threadDetail.timeline.map((day, dayIndex) => React.createElement(
                'details', {
                  key: day.dayKey,
                  className: 'ch-project-day',
                  open: dayIndex < 2 ? true : undefined,
                },
                React.createElement(
                  'summary', { className: 'ch-project-day-head' },
                  React.createElement('span', null,
                    `${dayLabel(t, day.dayKey)} · ${formatDayDate(day.dayKey, activeLocale)}`),
                  React.createElement('span', null,
                    t('daySummary', {
                      duration: day.activities.some(activity => activity.episodeCount > 1)
                        ? t('approxDuration', { duration: formatDuration(t, dayDuration(day)) })
                        : formatDuration(t, dayDuration(day)),
                      count: day.activityCount,
                    })),
                ),
                React.createElement(
                  'ul', { className: 'ch-project-activity-list' },
                  ...day.activities.map(activity => {
                    const app = episodeApp(activity)
                    return React.createElement(
                      'li', { key: activity.activityKey },
                      React.createElement('span', { className: 'ch-project-time' },
                        `${formatClock(activity.startedAtMs, activeLocale)}–${formatClock(activity.endedAtMs, activeLocale)}`),
                      React.createElement(
                        'span', { className: 'ch-project-activity-copy' },
                        React.createElement('span', { className: 'ch-project-activity-title' },
                          episodeSubject(t, activity)),
                        React.createElement('span', { className: 'ch-project-activity-meta' },
                          episodeMeta(t, activity, app)),
                      ),
                      React.createElement('span', { className: 'ch-project-duration' },
                        activityDurationText(t, activity)),
                    )
                  }),
                ),
              )),
            ),
          )
        })()
      : threadDetailPendingKey
        ? React.createElement('p', { className: 'ch-muted', role: 'status' }, t('projectHistoryLoading'))
        : threadDetailError
          ? React.createElement('p', { className: 'ch-muted', role: 'alert' }, t('projectHistoryUnavailable'))
          : null

    const threadSection = section(
      t('workThreads'),
      threads === undefined
        ? threadSkeleton(t('workThreadsLoading'))
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
                  const isOpen = threadDetail?.thread.threadKey === thread.threadKey
                  return React.createElement(
                    'li', { key: thread.threadKey, className: 'ch-thread-item' },
                    React.createElement(
                      'button', {
                        type: 'button',
                        className: isOpen
                          ? 'ch-thread-action ch-thread-action-selected'
                          : 'ch-thread-action',
                        'aria-expanded': isOpen,
                        disabled: threadDetailPendingKey === thread.threadKey,
                        onClick: () => { void openThread(thread) },
                      },
                      React.createElement(
                        'span', { className: 'ch-thread-leading' },
                        React.createElement(
                          'span', { className: 'ch-thread-copy' },
                          React.createElement('span', { className: 'ch-thread-title' }, title),
                          resources
                            ? React.createElement('span', { className: 'ch-thread-resources' }, resources)
                            : null,
                        ),
                      ),
                      React.createElement('span', { className: 'ch-thread-meta' },
                        t('threadActivityMeta', {
                          activities: thread.activityCount,
                          duration: t('approxDuration', {
                            duration: formatDuration(t, thread.approxActiveDurationMs),
                          }),
                        })),
                      React.createElement('span', { className: 'ch-thread-chevron', 'aria-hidden': true }, '›'),
                    ),
                  )
                }),
              ),
      threadDetailView,
    )

    const summaryStatus = (() => {
      const status = summaryDisplayStatus(semantic)
      if (status === 'loading') return t('summaryLoading')
      if (status === 'unavailable') return t('summaryUnavailable')
      if (status === 'remote') return t('summaryRemoteShort')
      if (status === 'local') return t('summaryLocalShort')
      return t('summaryDeterministicShort')
    })()

    const allContentUnavailable = hasAnyEpisode === null
      && timeline === null
      && threads === null
      && semantic === null
    const unavailableSection = React.createElement(
      'section', { className: 'ch-state-card', role: 'alert' },
      React.createElement('div', { className: 'ch-state-mark', 'aria-hidden': true }, '!'),
      React.createElement(
        'div', { className: 'ch-state-copy' },
        React.createElement('h2', null, t('historyUnavailableTitle')),
        React.createElement('p', { className: 'ch-muted' },
          failureText(t, controls.error ?? contentError)),
      ),
      React.createElement('button', {
        type: 'button', className: 'ch-button', onClick: retryLoads,
      }, t('retry')),
    )

    const accessibilityRecovery = !isFirstRun
      && state !== undefined
      && (state.capture === 'permission-required' || !state.accessibilityTrusted)
      ? React.createElement(
          'section', { className: 'ch-alert' },
          React.createElement('p', null, t('accessibilityRecoveryBody')),
          accessibilitySettingsAvailable
            ? React.createElement('button', {
                type: 'button', className: 'ch-button', disabled: awaitingAccessibility,
                onClick: () => { runAction(openAccessibilitySettings) },
              }, awaitingAccessibility ? t('waitingForPermission') : t('openSystemSettings'))
            : React.createElement('p', { className: 'ch-muted' }, t('accessibilityManualPath')),
        )
      : null

    const offerAllowedAppsRecovery = shouldOfferAllowedAppsRecovery({
      isFirstRun,
      reason: state?.reason,
      hasPreset: preset !== undefined,
    })
    const captureNeedsRecovery = !isFirstRun
      && state?.enabled === true
      && (state.capture === 'stopped' || state.capture === 'degraded')
    const captureRecovery = captureNeedsRecovery
      ? React.createElement(
          'section', { className: 'ch-alert' },
          React.createElement('p', null, t('captureRecoveryBody')),
          state?.reason
            ? React.createElement('p', { className: 'ch-muted' }, reasonText(t, state.reason))
            : null,
          React.createElement('button', {
            type: 'button', className: 'ch-button', disabled: captureRecoveryPending,
            onClick: () => { runAction(recoverCapture) },
          }, t(captureRecoveryPending ? 'recoveringRecording' : 'retryRecording')),
        )
      : null

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
              ...semantic.scopes.map(scope => {
                const matchingThread = threads && threads !== null
                  ? threads.find(thread => thread.threadKey === scope.scopeKey)
                  : undefined
                const appBundleId = scope.scopeKey.startsWith('app:')
                  ? scope.scopeKey.slice('app:'.length)
                  : undefined
                const title = matchingThread?.workspaceTitle
                  ?? (appBundleId ? friendlyAppName(appBundleId) : t('summaryScope'))
                const provider = scope.providerKind === 'remote'
                  ? t('summaryRemoteProvider')
                  : t('summaryLocalProvider')
                return React.createElement(
                  'li', { key: scope.scopeKey, className: 'ch-summary-item' },
                  React.createElement('div', { className: 'ch-summary-item-title' }, title),
                  React.createElement('p', { className: 'ch-muted' }, provider),
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
                  React.createElement(
                    'details', { className: 'ch-inspector' },
                    React.createElement('summary', null, t('technicalDetails')),
                    React.createElement('p', { className: 'ch-muted' }, t('summaryTechnicalMeta', {
                      scope: scope.scopeKey,
                      provider: scope.providerKind,
                      model: scope.model ? ` · ${scope.model}` : '',
                    })),
                  ),
                )
              }),
            )
          : semantic === undefined || semantic === null
            ? null
            : React.createElement('p', { className: 'ch-muted' }, t('noModelScope')),
        preview
          ? React.createElement(
              'details', { className: 'ch-inspector', open: true },
              React.createElement('summary', null, t('previewPayload')),
              React.createElement('pre', { className: 'ch-code' }, preview),
            )
          : null,
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
          React.createElement(
            'div', { className: 'ch-status-line', role: 'status' },
            React.createElement('span', { className: statusDotClass, 'aria-hidden': true }),
            React.createElement('span', { className: 'ch-status-primary' }, statusPrimary),
            React.createElement('span', { className: 'ch-status-separator', 'aria-hidden': true }, '·'),
            React.createElement('span', { className: 'ch-status-meta' }, t('metadataOnly')),
            React.createElement('span', { className: 'ch-status-separator', 'aria-hidden': true }, '·'),
            React.createElement('span', { className: 'ch-status-summary' }, statusSummary),
          ),
        ),
      ),
      staleSection,
      maintenanceSection,
      accessibilityRecovery,
      captureRecovery,
      state?.reason && !captureNeedsRecovery && !(isFirstRun && state.reason === 'no-apps-allowed')
        ? React.createElement(
            'div', { className: 'ch-alert' },
            React.createElement('p', null, reasonText(t, state.reason)),
            offerAllowedAppsRecovery
              ? React.createElement('button', {
                  type: 'button',
                  className: 'ch-button',
                  disabled: startRecordingPending,
                  onClick: () => { runAction(startRecording) },
                }, t(startRecordingPending ? 'allowingPresetApps' : 'allowPresetApps'))
              : null,
          )
        : null,
      !allContentUnavailable && ((controls.status === 'error' && controls.error) || contentError)
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
      allContentUnavailable
        ? unavailableSection
        : React.createElement(
            React.Fragment,
            null,
            isFirstRun ? firstRunSection : timelineSection,
            !isFirstRun && timeline && timeline.length > 0 ? resumeSection : null,
            !isFirstRun ? threadSection : null,
            !isFirstRun ? semanticSection : null,
          ),
    )
  }
}
