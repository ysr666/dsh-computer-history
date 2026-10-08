import React from 'react'
import type {
  EpisodeDetail,
  EpisodeSummary,
  PolicySnapshot,
  ResumeHandoff,
  ResumeOpenCapability,
  ResumeResolution,
  SemanticSummaryState,
  TimelineActivity,
  TimelineDay,
  WorkThread,
  WorkThreadDetail,
} from '../shared/index.js'
import { localDayKey } from '../shared/audit-view.js'
import { historyApi } from './api.js'
import { renderSelectedActivityDetail } from './episode-detail-view.js'
import {
  activityDurationText, dayDuration, dayLabel,
  episodeMeta, formatClock, formatDayDate, formatDuration, formatRelativeAge,
  renderTimelineDay, timelineSkeleton, threadSkeleton,
} from './timeline-view.js'
import { appIcon } from './app-icon.js'
import { HistoryGlyph } from './history-icon.js'
import {
  continuationResourceUri,
  continuationSubject,
  episodeApp,
  episodeSubject,
  friendlyAppName,
  pickContinuationEpisode,
} from './episode-subject.js'
import {
  captureLabel,
  failureText,
  reasonText,
  type HistoryTranslate,
} from './locale.js'
import type { HistoryControlStore } from './store.js'
import type { ComputerHistoryPluginNavigation } from './plugin-navigation.js'
import {
  firstRunBundles,
  setupStage,
  shouldOfferAllowedAppsRecovery,
  type SetupStage,
} from './setup-state.js'

interface PanelFactoryOptions {
  readonly getActiveLocale: () => string
  readonly getPluginNavigation?: () => ComputerHistoryPluginNavigation | undefined
  readonly continueInDsh: (episode: EpisodeSummary) => Promise<void>
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

function resumeResolutionMessage(
  t: HistoryTranslate,
  resolution: Exclude<ResumeResolution, { readonly status: 'hit' }>,
): string {
  if (resolution.status === 'ambiguous') {
    const resourceMatch = /^resource (.+) exists in multiple workspaces$/.exec(resolution.reason)
    if (resourceMatch?.[1]) {
      return t('resumeAmbiguousResource', { resource: resourceMatch[1] })
    }
    if (resolution.reason === 'surface recency is tied across workspaces') {
      return t('resumeAmbiguousSurfaceTie')
    }
    return t('resumeAmbiguousGeneric')
  }

  if (resolution.reason === 'no eligible recent episodes') return t('resumeNoneRecent')
  if (resolution.reason === 'workspace episode unavailable') return t('resumeNoneWorkspace')
  if (resolution.reason === 'the best match has no citations, so it is not a hint') {
    return t('resumeNoneUnverified')
  }
  if (resolution.reason === 'query is not eligible for automatic resume') {
    return t('resumeNoneIneligible')
  }
  return t('resumeNoneGeneric')
}

export type SummaryDisplayStatus =
  | 'loading'
  | 'unavailable'
  | 'provider-unavailable'
  | 'deterministic'
  | 'local'
  | 'remote'

export function summaryDisplayStatus(
  semantic: SemanticSummaryState | null | undefined,
): SummaryDisplayStatus {
  if (semantic === undefined) return 'loading'
  if (semantic === null) return 'unavailable'
  if (semantic.scopes.some(scope =>
    scope.providerKind === 'remote' && semantic.providers.remote.available
  )) return 'remote'
  if (semantic.scopes.some(scope =>
    scope.providerKind === 'local' && semantic.providers.local.available
  )) return 'local'
  if (semantic.scopes.length > 0) return 'provider-unavailable'
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

export function createHistoryPage({
  getActiveLocale,
  getPluginNavigation,
  continueInDsh,
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
    const [recentEpisodes, setRecentEpisodes] = React.useState<readonly EpisodeSummary[] | null>()
    const [latestEpisode, setLatestEpisode] = React.useState<EpisodeSummary | null>()
    const [accessibilitySettingsAvailable, setAccessibilitySettingsAvailable] = React.useState(false)
    const [awaitingAccessibility, setAwaitingAccessibility] = React.useState(false)
    const [threads, setThreads] = React.useState<readonly WorkThread[] | null>()
    const [showAllThreads, setShowAllThreads] = React.useState(false)
    const [threadDetail, setThreadDetail] = React.useState<WorkThreadDetail>()
    const [threadDetailKey, setThreadDetailKey] = React.useState<string>()
    const [threadDetailPendingKey, setThreadDetailPendingKey] = React.useState<string>()
    const [threadDetailError, setThreadDetailError] = React.useState<string>()
    const [resumeQuery, setResumeQuery] = React.useState('')
    const [hint, setHint] = React.useState<ResumeResolution>()
    const [resumeHandoff, setResumeHandoff] = React.useState<ResumeHandoff | null>()
    const [resumeOpenCapability, setResumeOpenCapability] = React.useState<ResumeOpenCapability>()
    const [resumeOpenPending, setResumeOpenPending] = React.useState(false)
    const [continueDshPending, setContinueDshPending] = React.useState(false)
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
        historyApi.getRecent(8),
        historyApi.getThreads(20),
        historyApi.getSemanticState(),
        historyApi.getTimeline(8),
      ] as const)
      const [recentResult, threadResult, semanticResult, timelineResult] = results
      if (!contentRequests.current.isCurrent(request)) return
      setHasAnyEpisode(recentResult.status === 'fulfilled'
        ? recentResult.value.length > 0
        : null)
      setRecentEpisodes(recentResult.status === 'fulfilled'
        ? recentResult.value
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
      setThreadDetailKey(undefined)
      setThreadDetailPendingKey(undefined)
      setThreadDetailError(undefined)
      setHint(undefined)
      setResumeHandoff(undefined)
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

    const continueInDshWork = async (episode: EpisodeSummary): Promise<void> => {
      setActionError(undefined)
      setContinueDshPending(true)
      try {
        await continueInDsh(episode)
      } catch (cause) {
        setActionError(failureText(t, cause))
      } finally {
        setContinueDshPending(false)
      }
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
      await historyApi.revokeSemantic(scopeKey)
      setPreview(undefined)
      setSemantic(await historyApi.getSemanticState())
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
      if (threadDetailKey === thread.threadKey) {
        threadRequests.current.invalidate()
        setThreadDetail(undefined)
        setThreadDetailKey(undefined)
        setThreadDetailPendingKey(undefined)
        setThreadDetailError(undefined)
        return
      }
      const request = threadRequests.current.begin()
      setThreadDetail(undefined)
      setThreadDetailKey(thread.threadKey)
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

    const toggleThreadDisclosure = (): void => {
      if (showAllThreads && threads) {
        const visibleKeys = new Set(threads.slice(0, 6).map(thread => thread.threadKey))
        if (threadDetailKey && !visibleKeys.has(threadDetailKey)) {
          threadRequests.current.invalidate()
          setThreadDetail(undefined)
          setThreadDetailKey(undefined)
          setThreadDetailPendingKey(undefined)
          setThreadDetailError(undefined)
        }
      }
      setShowAllThreads(current => !current)
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
    const pluginNavigation = getPluginNavigation?.()
    const staleSection = staleRelease
      ? React.createElement(
          'section', { className: 'ch-alert ch-alert-warning' },
          React.createElement('p', { role: 'status' }, t('staleRelease')),
          pluginNavigation
            ? React.createElement(React.Fragment, null,
                React.createElement('p', { className: 'ch-muted' }, t('staleManagedUpdate')),
                React.createElement('button', {
                  type: 'button', className: 'ch-button',
                  onClick: () => { pluginNavigation.open() },
                }, t('openInPlugins')),
              )
            : null,
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
      && hasAnyEpisode === false
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
          type: 'button', className: 'ch-button ch-continue-primary', disabled: !preset || startRecordingPending,
          onClick: () => { runAction(startRecording) },
        }, t(!state?.accessibilityTrusted && accessibilitySettingsAvailable
          ? 'startAndAuthorize'
          : 'startRecording'))
      : setup === 'permission' && accessibilitySettingsAvailable
        ? React.createElement('button', {
            type: 'button', className: 'ch-button ch-continue-primary', disabled: awaitingAccessibility,
            onClick: () => { runAction(openAccessibilitySettings) },
          }, awaitingAccessibility ? t('waitingForPermission') : t('openSystemSettings'))
        : setup === 'paused'
          ? React.createElement('button', {
              type: 'button', className: 'ch-button ch-continue-primary',
              onClick: () => { runAction(async () => { await store.resume() }) },
            }, t('resumeRecording'))
          : setup === 'stopped' || setup === 'degraded'
            ? React.createElement('button', {
                type: 'button', className: 'ch-button ch-continue-primary', disabled: captureRecoveryPending,
                onClick: () => { runAction(recoverCapture) },
              }, t(captureRecoveryPending ? 'recoveringRecording' : 'retryRecording'))
            : null
    const firstRunSection = isFirstRun
      ? React.createElement(
          'section', { className: 'ch-first-run' },
          React.createElement(
            'div',
            { className: 'ch-first-run-mark', 'aria-hidden': true },
            React.createElement(HistoryGlyph, { size: 21 }),
          ),
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
              ? React.createElement(
                  React.Fragment, null,
                  React.createElement('p', { className: 'ch-muted' }, reasonText(t, state.reason)),
                  // Naming it is only half of it. This reason exists because the first-run consent never wrote an
                  // allow rule, so the notice offers that same consent again - the action the consent itself runs
                  // (`startRecording`), through the same `runAction` wrapper, with no second way to write a policy.
                  // Measured 2026-10-06: the state said `running` while nothing was recorded, and the only thing
                  // the panel could do about it was print a line of grey text.
                  state.reason === 'no-apps-allowed' && preset
                    ? React.createElement('button', {
                        type: 'button',
                        className: 'ch-button ch-continue-primary',
                        onClick: () => { runAction(startRecording) },
                      }, t('allowPresetApps'))
                    : null,
                )
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
    const recentEpisode = recentEpisodes && recentEpisodes !== null
      ? pickContinuationEpisode(recentEpisodes)
      : undefined
    React.useEffect(() => {
      if (!recentEpisode) {
        setResumeHandoff(undefined)
        return
      }
      let active = true
      setResumeHandoff(undefined)
      void historyApi.getResumeHandoff(String(recentEpisode.id))
        .then(handoff => { if (active) setResumeHandoff(handoff) })
        .catch(() => { if (active) setResumeHandoff(null) })
      return () => { active = false }
    }, [recentEpisode?.id, recentEpisode?.endedAtMs])

    React.useEffect(() => {
      const refreshContinuationOnFocus = (): void => {
        void refreshContent()
        if (!recentEpisode) return
        void historyApi.getResumeHandoff(String(recentEpisode.id))
          .then(setResumeHandoff)
          .catch(() => { setResumeHandoff(null) })
      }
      window.addEventListener('focus', refreshContinuationOnFocus)
      return () => { window.removeEventListener('focus', refreshContinuationOnFocus) }
    }, [recentEpisode?.id, refreshContent])

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

    const selectedActivityDetail = selectedActivity && selected
      ? renderSelectedActivityDetail({
          t, selectedActivity, selected, selectedRawEpisodes, activeLocale,
        })
      : null

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
                ...timeline.map((day, dayIndex) => renderTimelineDay({
                  t, day, dayIndex, locale: activeLocale,
                  selectedActivity, selectedActivityDetail,
                  onOpenActivity: activity => { runAction(() => openActivity(activity)) },
                })),
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

    )

    const resumeText = hint
      ? hint.status === 'hit'
        ? t('resumeHit', {
            title: hint.episode.workspace?.title ?? hint.episode.id,
            resource: hint.resource?.displayLabel ?? hint.resource?.canonicalUri ?? t('lastActivity'),
          })
        : resumeResolutionMessage(t, hint)
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

    const handoffHit = resumeHandoff?.status === 'hit' ? resumeHandoff : undefined
    const savedResources = handoffHit?.changedResources
      ?? recentEpisode?.changedResources
      ?? []
    const referenceResources = handoffHit?.referenceResources ?? []
    const latestVerification = handoffHit?.verifications[0]
    const verificationKindLabel = latestVerification
      ? t(latestVerification.kind === 'build'
          ? 'verificationBuild'
          : latestVerification.kind === 'test'
            ? 'verificationTest'
            : 'verificationOther')
      : undefined
    const verificationLabel = latestVerification && verificationKindLabel
      ? t(latestVerification.result === 'success'
          ? 'verificationSucceeded'
          : 'verificationFailed', { kind: verificationKindLabel })
      : undefined
    const checkpoint = handoffHit?.checkpoint
    const gitHeadChanged = Boolean(
      handoffHit?.git?.head
      && checkpoint?.gitHead
      && handoffHit.git.head !== checkpoint.gitHead,
    )
    const continueSubject = handoffHit?.workspace?.title?.trim()
      ?? (recentEpisode ? continuationSubject(recentEpisode) : undefined)
      ?? (recentEpisode ? episodeSubject(t, recentEpisode) : undefined)
    const continueResource = handoffHit?.lastActiveResource?.displayLabel
      ?? recentEpisode?.lastStrongResource?.displayLabel
      ?? recentEpisode?.resources[0]?.displayLabel
    const continueMeta = recentEpisode
      ? continueResource && continueResource !== continueSubject
        ? t('resumeRecentMetaResource', {
            when: formatRelativeAge(t, recentEpisode.endedAtMs),
            app: episodeApp(recentEpisode),
            resource: continueResource,
          })
        : t('resumeRecentMeta', {
            when: formatRelativeAge(t, recentEpisode.endedAtMs),
            app: episodeApp(recentEpisode),
          })
      : undefined

    const resumeSection = section(
      t('resume'),
      React.createElement(
        'div', { className: 'ch-resume-card' },
        recentEpisode
          ? React.createElement(
              'div', { className: 'ch-continuity-card' },
              React.createElement(
                'div', { className: 'ch-continuity-head' },
                appIcon(recentEpisode.surfaces[0]?.bundleId, episodeApp(recentEpisode)),
                React.createElement(
                  'span', { className: 'ch-resume-copy' },
                  React.createElement('span', { className: 'ch-resume-title' }, continueSubject),
                  React.createElement('span', { className: 'ch-resume-meta' }, continueMeta),
                ),
                React.createElement(
                  'div', { className: 'ch-continuity-actions' },
                  React.createElement('button', {
                    type: 'button',
                    className: 'ch-button ch-resume-open ch-continue-primary',
                    disabled: continueDshPending,
                    onClick: () => { void continueInDshWork(recentEpisode) },
                  }, continueDshPending ? t('continuingWork') : t('continueWork')),
                  resumeOpenCapability?.available
                    ? React.createElement('button', {
                        type: 'button',
                        className: 'ch-text-action ch-open-app',
                        disabled: resumeOpenPending,
                        onClick: () => {
                          void continueRecordedWork(
                            recentEpisode,
                            continuationResourceUri(recentEpisode, resumeHandoff),
                          )
                        },
                      }, resumeOpenPending ? t('openingApp') : t('openInApp'))
                    : null,
                ),
              ),
              handoffHit && (
                savedResources.length > 0
                || referenceResources.length > 0
                || verificationLabel !== undefined
                || handoffHit.git !== undefined
                || handoffHit.checkpoint !== undefined
              )
                ? React.createElement(
                    'details', { className: 'ch-inspector ch-continuity-inspector' },
                    React.createElement('summary', null, t('workStateDetails')),
                    verificationLabel
                      ? React.createElement('p', { className: 'ch-muted' }, verificationLabel)
                      : null,
                    savedResources.length > 0
                      ? React.createElement(
                          React.Fragment,
                          null,
                          React.createElement('p', { className: 'ch-continuity-detail-label' },
                            t('recentlySaved')),
                          React.createElement(
                            'ul', { className: 'ch-continuity-files ch-continuity-detail-files' },
                            ...savedResources.slice(0, 5).map(resource => React.createElement(
                              'li', { key: resource.canonicalUri },
                              React.createElement('span', { className: 'ch-continuity-file' },
                                resource.displayLabel ?? resource.canonicalUri),
                              React.createElement('span', { className: 'ch-continuity-file-meta' },
                                t('savedTimes', { count: resource.changeCount })),
                            )),
                          ),
                        )
                      : null,
                    referenceResources.length > 0
                      ? React.createElement(
                          React.Fragment,
                          null,
                          React.createElement('p', { className: 'ch-continuity-detail-label' },
                            t('references')),
                          React.createElement(
                            'ul', { className: 'ch-continuity-files ch-continuity-detail-files' },
                            ...referenceResources.slice(0, 5).map(resource => React.createElement(
                              'li', { key: resource.canonicalUri },
                              React.createElement('span', { className: 'ch-continuity-file' },
                                resource.displayLabel ?? resource.canonicalUri),
                            )),
                          ),
                        )
                      : null,
                    handoffHit.git?.branch
                      ? React.createElement('p', { className: 'ch-muted' },
                          t('gitBranchMeta', { branch: handoffHit.git.branch }))
                      : null,
                    handoffHit.git?.head
                      ? React.createElement('p', { className: 'ch-muted' },
                          t('gitHeadMeta', { head: handoffHit.git.head.slice(0, 10) }))
                      : null,
                    gitHeadChanged
                      ? React.createElement('p', { className: 'ch-muted' }, t('gitHeadChanged'))
                      : null,
                    handoffHit.git?.dirty && handoffHit.git.changedFiles.length > 0
                      ? React.createElement(
                          React.Fragment,
                          null,
                          React.createElement('p', { className: 'ch-continuity-detail-label' },
                            t('currentGitChanges')),
                          React.createElement(
                            'ul', { className: 'ch-continuity-files ch-continuity-detail-files' },
                            ...handoffHit.git.changedFiles.slice(0, 6).map(file => React.createElement(
                              'li', { key: file.status + ':' + file.path },
                              React.createElement('span', { className: 'ch-continuity-status-code' },
                                file.status),
                              React.createElement('span', { className: 'ch-continuity-file' }, file.path),
                            )),
                          ),
                        )
                      : null,
                    handoffHit.checkpoint
                      ? React.createElement('p', { className: 'ch-muted' },
                          t('checkpointMeta', {
                            session: handoffHit.checkpoint.sessionId,
                            turn: handoffHit.checkpoint.turn,
                          }))
                      : null,
                  )
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
              hint?.status === 'hit'
                ? React.createElement('button', {
                    type: 'button',
                    className: 'ch-button',
                    disabled: continueDshPending,
                    onClick: () => { void continueInDshWork(hint.episode) },
                  }, continueDshPending ? t('continuingWork') : t('continueWork'))
                : null,
            )
          : null,
      ),
    )

    const threadDetailView = threadDetail
      ? (() => {
          return React.createElement(
            'div', { className: 'ch-project-history' },
            React.createElement(
              'div', { className: 'ch-project-history-head' },
              React.createElement('span', { className: 'ch-project-history-kicker' }, t('projectHistory')),
              React.createElement('span', { className: 'ch-muted' },
                t('projectHistoryMeta', {
                  days: threadDetail.timeline.length,
                })),
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
                  React.createElement('span', {
                    className: 'ch-project-day-chevron',
                    'aria-hidden': true,
                  }, '›'),
                ),
                React.createElement(
                  'ul', { className: 'ch-project-activity-list' },
                  ...day.activities.map(activity => {
                    const app = episodeApp(activity)
                    return React.createElement(
                      'li', { key: activity.activityKey },
                      React.createElement('span', { className: 'ch-project-time' },
                        `${formatClock(activity.startedAtMs, activeLocale)}–${formatClock(activity.endedAtMs, activeLocale)}`),
                      appIcon(activity.surfaces[0]?.bundleId, app, { compact: true }),
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
                ...(showAllThreads ? threads : threads.slice(0, 6)).map(thread => {
                  const title = thread.workspaceTitle ?? t('unnamedWorkspace')
                  const resources = thread.resources
                    .slice(0, 2)
                    .map(resource => resource.displayLabel ?? resource.canonicalUri)
                    .join(', ')
                  const isOpen = threadDetailKey === thread.threadKey
                  const inlineDetail = !isOpen
                    ? null
                    : threadDetailPendingKey === thread.threadKey
                      ? React.createElement(
                          'p',
                          { className: 'ch-thread-inline-status ch-muted', role: 'status' },
                          t('projectHistoryLoading'),
                        )
                      : threadDetail?.thread.threadKey === thread.threadKey
                        ? threadDetailView
                        : threadDetailError
                          ? React.createElement(
                              'p',
                              { className: 'ch-thread-inline-status ch-muted', role: 'alert' },
                              t('projectHistoryUnavailable'),
                            )
                          : null
                  return React.createElement(
                    'li', {
                      key: thread.threadKey,
                      className: isOpen
                        ? 'ch-thread-item ch-thread-item-open'
                        : 'ch-thread-item',
                    },
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
                        t('threadRecentMeta', {
                          when: formatRelativeAge(t, thread.endedAtMs),
                          activities: thread.activityCount,
                          duration: t('approxDuration', {
                            duration: formatDuration(t, thread.approxActiveDurationMs),
                          }),
                        })),
                      React.createElement('span', { className: 'ch-thread-chevron', 'aria-hidden': true }, '›'),
                    ),
                    inlineDetail,
                  )
                }),
              ),
      threads && threads.length > 6
        ? React.createElement(
            'div', { className: 'ch-thread-more' },
            React.createElement('button', {
              type: 'button',
              className: 'ch-text-action',
              onClick: toggleThreadDisclosure,
            }, showAllThreads
              ? t('showFewerThreads')
              : t('showMoreThreads', { count: threads.length - 6 })),
          )
        : null,
    )

    const summaryStatus = (() => {
      const status = summaryDisplayStatus(semantic)
      if (status === 'loading') return t('summaryLoading')
      if (status === 'unavailable') return t('summaryUnavailable')
      if (status === 'provider-unavailable') return t('summaryProviderUnavailableShort')
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
        type: 'button', className: 'ch-button ch-continue-primary', onClick: retryLoads,
      }, t('retry')),
    )

    const accessibilityNeedsRecovery = !isFirstRun
      && state !== undefined
      && (state.capture === 'permission-required' || !state.accessibilityTrusted)
    const accessibilityRecovery = accessibilityNeedsRecovery
      ? React.createElement(
          'section', { className: 'ch-alert ch-alert-warning' },
          React.createElement('p', null, t('accessibilityRecoveryBody')),
          accessibilitySettingsAvailable
            ? React.createElement('button', {
                type: 'button', className: 'ch-button ch-continue-primary', disabled: awaitingAccessibility,
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
          'section', { className: 'ch-alert ch-alert-error' },
          React.createElement('p', null, t('captureRecoveryBody')),
          state?.reason
            ? React.createElement('p', { className: 'ch-muted' }, reasonText(t, state.reason))
            : null,
          React.createElement('button', {
            type: 'button', className: 'ch-button ch-continue-primary', disabled: captureRecoveryPending,
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
                const readiness = semantic.providers[scope.providerKind]
                const providerName = scope.providerKind === 'remote'
                  ? t('summaryRemoteProvider')
                  : t('summaryLocalProvider')
                const provider = readiness.available
                  ? providerName
                  : `${providerName} · ${t('summaryProviderUnavailable')}`
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
            : React.createElement(
                'p',
                { className: 'ch-muted' },
                !semantic.providers.local.available && !semantic.providers.remote.available
                  ? t('noSummaryProvider')
                  : t('noModelScope'),
              ),
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
            'div', { className: 'ch-alert ch-alert-error' },
            React.createElement('p', { role: 'alert' }, failureText(t, controls.error ?? contentError)),
            React.createElement('div', { className: 'ch-controls' },
              React.createElement('button', {
                type: 'button', className: 'ch-button', onClick: retryLoads,
              }, t('retry')),
            ),
          )
        : null,
      actionError
        ? React.createElement('div', { className: 'ch-alert ch-alert-error', role: 'alert' }, actionError)
        : null,
      allContentUnavailable
        ? unavailableSection
        : React.createElement(
            React.Fragment,
            null,
            isFirstRun ? firstRunSection : null,
            !isFirstRun && hasAnyEpisode ? resumeSection : null,
            !isFirstRun ? timelineSection : null,
            !isFirstRun ? threadSection : null,
            !isFirstRun ? semanticSection : null,
          ),
    )
  }
}
