import React from 'react'
import type {
  EpisodeDetail,
  PolicySnapshot,
  ResumeResolution,
  SemanticSummaryState,
  TimelineDay,
  WorkThread,
} from '../shared/index.js'
import { describeProvenance } from '../shared/audit-view.js'
import { historyApi } from './api.js'
import {
  captureLabel,
  episodeLineText,
  failureText,
  reasonText,
  threadSubjectText,
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
      const failure = results.find(result => result.status === 'rejected')
      setContentError(
        failure?.status === 'rejected' ? failureText(t, failure.reason) : undefined,
      )
    }, [])

    React.useEffect(() => {
      void store.load().catch(() => {})
      void refreshContent()
    }, [])
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

    const durationLabel = (item: TimelineDay['episodes'][number]): string => {
      const minutes = Math.round((item.endedAtMs - item.startedAtMs) / 60_000)
      if (!Number.isFinite(minutes) || minutes < 1) {
        return t('underMinute')
      }
      return t('minutes', { minutes })
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
    const presetText = (value: Record<string, string> | undefined): string => {
      if (!value) return ''
      const activeLocale = getActiveLocale().toLowerCase()
      return (activeLocale.startsWith('zh') ? value.zh ?? value.en : value.en ?? value.zh) ?? ''
    }
    const firstRunSection = isFirstRun
      ? section(
          t('startHere'),
          React.createElement('p', { className: 'ch-muted' }, t('firstRunIntro')),
          preset
            ? React.createElement(React.Fragment, null,
                React.createElement('p', { className: 'ch-row-title' }, presetText(preset.title)),
                React.createElement('p', { className: 'ch-muted' }, presetText(preset.description)),
              )
            : null,
          React.createElement('p', { className: 'ch-muted' }, t('firstRunPrivacy')),
          React.createElement('button', {
            type: 'button', className: 'ch-button', disabled: !preset,
            onClick: () => { runAction(startRecording) },
          }, t('startRecording')),
        )
      : null

    const timelineSection = section(
      t('timeline'),
      timeline === undefined
        ? React.createElement('p', { className: 'ch-muted', role: 'status' }, t('timelineLoading'))
        : timeline === null
          ? React.createElement('p', { className: 'ch-muted' }, t('timelineUnavailable'))
          : timeline.length === 0
          ? React.createElement('p', { className: 'ch-muted' }, t('timelineEmpty'))
          : React.createElement('div', null,
            ...timeline.map(day => React.createElement(
              'div', { key: day.dayKey, className: 'ch-timeline-day' },
              React.createElement('p', { className: 'ch-timeline-heading' },
                day.episodeCount === 1
                  ? t('timelineDayOne', { day: day.dayKey })
                  : t('timelineDayMany', { day: day.dayKey, count: day.episodeCount })),
              React.createElement('ul', { className: 'ch-timeline-list' },
                ...day.episodes.map(item => React.createElement(
                  'li', { key: String(item.id), className: 'ch-timeline-item' },
                  React.createElement('span', { className: 'ch-duration' }, durationLabel(item)),
                  React.createElement('button', {
                    type: 'button',
                    className: 'ch-text-action',
                    onClick: () => { runAction(() => openEpisode(String(item.id))) },
                  }, episodeLineText(t, item)),
                )),
              ),
            )),
          ),
      selected
        ? React.createElement(
            'div', { className: 'ch-detail' },
            React.createElement('h3', { className: 'ch-row-title' }, t('whyRecorded')),
            React.createElement('p', { className: 'ch-row-body' }, describeProvenance({
              boundary: selected.boundary,
              policyRevision: 0,
              citations: selected.summaryObservationIds,
              resources: selected.resources,
              surfaces: selected.surfaces,
              confidence: selected.confidence,
            })),
            React.createElement('p', { className: 'ch-muted' },
              selected.resources.length > 0
                ? t('resources', {
                    resources: selected.resources
                      .map(item => item.displayLabel ?? item.canonicalUri)
                      .join(', '),
                  })
                : t('noResourceApps', {
                    apps: selected.surfaces.map(item => item.bundleId).join(', '),
                  })),
          )
        : null,
    )

    const semanticSection = section(
      t('summaries'),
      React.createElement('p', { className: 'ch-muted' },
        semantic === undefined
          ? t('summaryLoading')
          : semantic === null
            ? t('summaryUnavailable')
            : semantic.scopes.some(scope => scope.providerKind === 'remote')
              ? t('summaryRemote')
              : t('summaryLocal', {
                  status: t(semantic.localProviderConfigured ? 'configured' : 'notConfigured'),
                })),
      semantic && semantic.scopes.length
        ? React.createElement('ul', { className: 'ch-list' },
            ...semantic.scopes.map(scope => React.createElement(
              'li', { key: scope.scopeKey, className: 'ch-row' },
              React.createElement('p', { className: 'ch-row-title' },
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
          : React.createElement('p', { className: 'ch-muted' },
              t('noModelScope')),
      semantic === null
        ? null
        : preview ? React.createElement('pre', { className: 'ch-code' }, preview) : null,
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

    const resumeSection = section(
      t('resume'),
      React.createElement('div', { className: 'ch-resume-controls' },
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
      ),
      resumeText
        ? React.createElement('p', { className: 'ch-row-body', role: 'status' }, resumeText)
        : null,
    )

    const threadSection = section(
      t('workThreads'),
      threads === undefined
        ? React.createElement('p', { className: 'ch-muted', role: 'status' }, t('workThreadsLoading'))
        : threads === null
          ? React.createElement('p', { className: 'ch-muted' }, t('workThreadsUnavailable'))
          : threads.length === 0
          ? React.createElement('p', { className: 'ch-muted' }, t('workThreadsEmpty'))
          : React.createElement('ul', { className: 'ch-list' },
            ...threads.map(thread => React.createElement(
              'li', { key: thread.threadKey, className: 'ch-row' },
              React.createElement('span', null, threadSubjectText(t, thread)),
              React.createElement('span', { className: 'ch-muted' },
                thread.episodeCount === 1
                  ? t('workThreadMetaOne', {
                      citations: thread.summaryObservationIds.length,
                    })
                  : t('workThreadMetaMany', {
                      episodes: thread.episodeCount,
                      citations: thread.summaryObservationIds.length,
                    })),
            )),
          ),
    )

    const statusText = state
      ? t('statusLine', {
          capture: captureLabel(t, state.capture),
          accessibility: t(state.accessibilityTrusted
            ? 'accessibilityGranted'
            : 'accessibilityRequired'),
          hours: state.observationRetentionHours,
        })
      : controls.status === 'error'
        ? t('stateUnavailable')
        : t('loadingHistory')

    return React.createElement(
      'main',
      { className: 'ch-main' },
      React.createElement('h1', null, t('title')),
      React.createElement('p', { className: 'ch-subtitle' }, t('subtitle')),
      staleSection,
      firstRunSection,
      React.createElement('p', { className: 'ch-status', role: 'status' }, statusText),
      state?.reason
        ? React.createElement('p', { className: 'ch-muted' },
            t('statusDetail', { reason: reasonText(t, state.reason) }))
        : null,
      (controls.status === 'error' && controls.error) || contentError
        ? React.createElement(
            'div', { className: 'ch-alert' },
            React.createElement('p', { role: 'alert' }, controls.error ?? contentError),
            React.createElement('button', {
              type: 'button', className: 'ch-button', onClick: retryLoads,
            }, t('retry')),
          )
        : null,
      actionError
        ? React.createElement('p', { className: 'ch-alert', role: 'alert' }, actionError)
        : null,
      timelineSection,
      semanticSection,
      resumeSection,
      threadSection,
    )
  }
}
