import React from 'react'
import type {
  BrowserCompanionSetup,
  ComputerHistoryState,
  DeleteHistoryRequest,
  PolicySnapshot,
} from '../shared/index.js'
import { RETENTION_BOUNDS } from '../shared/audit.js'
import { historyApi } from './api.js'
import {
  captureLabel,
  failureText,
  reasonText,
  type HistoryTranslate,
} from './locale.js'
import type {
  HistoryControlSnapshot,
  HistoryControlStore,
} from './store.js'

type Feedback = {
  readonly kind: 'success' | 'error'
  readonly text: string
} | undefined

export interface SettingsRowProps {
  readonly t: HistoryTranslate
  readonly store: HistoryControlStore
  readonly snapshot: HistoryControlSnapshot
}

function feedbackNode(feedback: Feedback): React.ReactNode {
  if (!feedback) return null
  return React.createElement('p', {
    className: feedback.kind === 'error'
      ? 'ch-feedback ch-feedback-error'
      : 'ch-feedback',
    role: feedback.kind === 'error' ? 'alert' : 'status',
  }, feedback.text)
}

function copy(title: string, description: string): React.ReactElement {
  return React.createElement(
    'span', { className: 'ch-settings-copy' },
    React.createElement('span', { className: 'ch-settings-title' }, title),
    React.createElement('span', { className: 'ch-settings-description' }, description),
  )
}

type SettingsIconName = 'record' | 'apps' | 'clock' | 'browser' | 'trash' | 'info'

const SETTINGS_ICON_PATHS: Record<SettingsIconName, string> = {
  record: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  browser: 'M4 5h16v14H4zM4 9h16M7 7h.01M10 7h.01',
  trash: 'M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7h.01',
}

function settingIcon(name: SettingsIconName): React.ReactElement {
  return React.createElement(
    'span', { className: 'ch-settings-icon-wrap', 'aria-hidden': true },
    React.createElement(
      'svg', {
        className: 'ch-settings-icon',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      React.createElement('path', { d: SETTINGS_ICON_PATHS[name] }),
    ),
  )
}

function value(text: string, options: { readonly connected?: boolean; readonly chevron?: boolean } = {}): React.ReactElement {
  return React.createElement(
    'span', { className: 'ch-settings-value' },
    options.connected === undefined
      ? null
      : React.createElement('span', {
          className: options.connected
            ? 'ch-settings-status-dot ch-settings-status-dot-success'
            : 'ch-settings-status-dot',
          'aria-hidden': true,
        }),
    React.createElement('span', null, text),
    options.chevron ? React.createElement('span', { className: 'ch-chevron', 'aria-hidden': true }, '›') : null,
  )
}

function controls(...children: React.ReactNode[]): React.ReactElement {
  return React.createElement('div', { className: 'ch-controls' }, ...children)
}

function detail(...children: React.ReactNode[]): React.ReactElement {
  return React.createElement('div', { className: 'ch-settings-detail' }, ...children)
}

function disclosure(
  icon: SettingsIconName,
  title: string,
  description: string,
  right: React.ReactNode,
  body: React.ReactNode,
  danger = false,
): React.ReactElement {
  return React.createElement(
    'li', { className: `ch-settings-item${danger ? ' ch-settings-danger' : ''}` },
    React.createElement(
      'details', { className: 'ch-settings-disclosure' },
      React.createElement(
        'summary', { className: 'ch-settings-summary' },
        settingIcon(icon),
        copy(title, description),
        right,
      ),
      body,
    ),
  )
}

export type CaptureControlMode = 'pause' | 'resume' | 'unavailable'

export function captureControlMode(
  state: ComputerHistoryState | undefined,
): CaptureControlMode {
  if (!state?.enabled) return 'unavailable'
  if (state.capture === 'running') return 'pause'
  if (state.capture === 'paused') return 'resume'
  return 'unavailable'
}

function friendlyBundleName(bundleId: string): string {
  const known: Record<string, string> = {
    'com.apple.Notes': 'Notes',
    'com.apple.Preview': 'Preview',
    'com.apple.Terminal': 'Terminal',
    'com.apple.finder': 'Finder',
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

function allowRuleUpdate(
  policy: PolicySnapshot,
  bundleId: string,
): PolicySnapshot['rules'] {
  const rules = policy.rules.filter(rule =>
    !(rule.dimension === 'app' && rule.pattern === bundleId),
  )
  const now = Date.now()
  return [...rules, {
    id: (`app:${bundleId}`) as never,
    dimension: 'app' as const,
    action: 'allow' as const,
    matcher: 'exact' as const,
    pattern: bundleId,
    builtIn: false,
    createdAtMs: now,
    updatedAtMs: now,
  }]
}

export function RecordingRow({
  t, store, snapshot,
}: SettingsRowProps): React.ReactElement {
  const [pending, setPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback>()
  const { state } = snapshot
  const mode = captureControlMode(state)
  const recording = mode === 'pause'

  const changeRecording = async (): Promise<void> => {
    if (mode === 'unavailable') return
    setPending(true)
    setFeedback(undefined)
    try {
      if (mode === 'pause') await store.pause()
      else await store.resume()
      setFeedback({
        kind: 'success',
        text: mode === 'pause' ? t('pausedFeedback') : t('recordingFeedback'),
      })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPending(false)
    }
  }

  const stateText = mode === 'pause'
    ? t('settingOn')
    : mode === 'resume'
      ? t('settingPaused')
      : t('settingUnavailable')

  return React.createElement(
    'li', { className: 'ch-settings-item' },
    React.createElement(
      'div', { className: 'ch-settings-line' },
      settingIcon('record'),
      copy(
        t('recordingTitle'),
        recording ? t('recordingOnDescriptionShort') : t('recordingOffDescriptionShort'),
      ),
      React.createElement(
        'span', { className: 'ch-settings-value' },
        React.createElement('span', null, stateText),
        React.createElement('button', {
          type: 'button',
          className: 'ch-switch',
          role: 'switch',
          'aria-checked': recording,
          'aria-label': t('recordingTitle'),
          disabled: pending || mode === 'unavailable',
          onClick: () => { void changeRecording() },
        }),
      ),
    ),
    state?.reason || feedback
      ? detail(
          state?.reason
            ? React.createElement('p', { className: 'ch-row-body' },
                t('whyReason', { reason: reasonText(t, state.reason) }))
            : null,
          feedbackNode(feedback),
        )
      : null,
  )
}

export function ApplicationsRow({
  t, store, snapshot,
}: SettingsRowProps): React.ReactElement {
  const [bundleId, setBundleId] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback>()
  const [showAll, setShowAll] = React.useState(false)
  const { policy } = snapshot
  const userRules = (policy?.rules ?? []).filter(rule => !rule.builtIn)
  const allowed = userRules.filter(rule => rule.action === 'allow')
  const denied = userRules.filter(rule => rule.action !== 'allow')
  const visibleAllowed = showAll ? allowed : allowed.slice(0, 5)

  const addApp = async (): Promise<void> => {
    const appId = bundleId.trim()
    if (!appId || !policy) return
    setPending(true)
    setFeedback(undefined)
    try {
      await store.replacePolicy({
        mode: 'include-only', rules: allowRuleUpdate(policy, appId),
      })
      setBundleId('')
      setFeedback({ kind: 'success', text: t('appAllowedFeedback') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPending(false)
    }
  }

  const forgetApp = async (appId: string): Promise<void> => {
    if (!policy) return
    setPending(true)
    setFeedback(undefined)
    try {
      const rules = policy.rules.filter(rule =>
        !(rule.dimension === 'app' && rule.pattern === appId),
      )
      await store.replacePolicy({ mode: 'include-only', rules })
      await store.deleteHistory({ scope: { kind: 'app', bundleId: appId } })
      setFeedback({ kind: 'success', text: t('appForgottenFeedback') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPending(false)
    }
  }

  return disclosure(
    'apps',
    t('applicationsTitle'),
    t('applicationsDescriptionShort'),
    value(t('applicationsValue', { count: allowed.length }), { chevron: true }),
    detail(
      React.createElement('p', { className: 'ch-row-body' }, t('applicationsSummary', {
        allowed: allowed.length,
        denied: denied.length,
      })),
      allowed.length === 0
        ? React.createElement('p', { className: 'ch-row-body' }, t('applicationsNone'))
        : React.createElement('ul', { className: 'ch-list' },
            ...visibleAllowed.map(rule => React.createElement(
              'li', { key: rule.id },
              React.createElement(
                'span', { className: 'ch-app-rule-copy' },
                React.createElement('span', { className: 'ch-app-rule-title' }, friendlyBundleName(rule.pattern)),
                React.createElement('span', { className: 'ch-app-rule-id' }, rule.pattern),
              ),
              React.createElement('button', {
                type: 'button', className: 'ch-button ch-button-danger', disabled: pending,
                onClick: () => { void forgetApp(rule.pattern) },
              }, t('forget')),
            )),
          ),
      allowed.length > 5
        ? React.createElement('button', {
            type: 'button',
            className: 'ch-text-action ch-list-more',
            onClick: () => { setShowAll(current => !current) },
          }, showAll
            ? t('showFewerApplications')
            : t('showMoreApplications', { count: allowed.length - 5 }))
        : null,
      React.createElement(
        'details', { className: 'ch-manual-add' },
        React.createElement('summary', null, t('manualAddApplication')),
        controls(
          React.createElement('input', {
            className: 'ch-input', value: bundleId,
            'aria-label': t('bundleIdAria'),
            placeholder: t('bundleIdPlaceholder'),
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              setBundleId(event.target.value)
            },
          }),
          React.createElement('button', {
            type: 'button', className: 'ch-button',
            disabled: pending || bundleId.trim().length === 0 || !policy,
            onClick: () => { void addApp() },
          }, t('allowApp')),
        ),
      ),
      feedbackNode(feedback),
    ),
  )
}

export function RetentionRow({
  t, store, snapshot,
}: SettingsRowProps): React.ReactElement {
  const { retention } = snapshot
  const [observationHours, setObservationHours] = React.useState('')
  const [episodeDays, setEpisodeDays] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback>()

  React.useEffect(() => {
    if (!retention) return
    setObservationHours(String(retention.observationRetentionHours))
    setEpisodeDays(String(retention.episodeRetentionDays))
  }, [retention])

  const save = async (): Promise<void> => {
    const observation = Number(observationHours)
    const episodes = Number(episodeDays)
    const observationBounds = RETENTION_BOUNDS.observationRetentionHours
    const episodeBounds = RETENTION_BOUNDS.episodeRetentionDays
    if (
      !Number.isInteger(observation)
      || observation < observationBounds.min
      || observation > observationBounds.max
      || !Number.isInteger(episodes)
      || episodes < episodeBounds.min
      || episodes > episodeBounds.max
    ) {
      setFeedback({
        kind: 'error',
        text: t('retentionValidation', {
          observationMin: observationBounds.min,
          observationMax: observationBounds.max,
          episodeMin: episodeBounds.min,
          episodeMax: episodeBounds.max,
        }),
      })
      return
    }
    setPending(true)
    setFeedback(undefined)
    try {
      await store.setRetention({
        observationRetentionHours: observation,
        episodeRetentionDays: episodes,
      })
      setFeedback({ kind: 'success', text: t('saved') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPending(false)
    }
  }

  return disclosure(
    'clock',
    t('retentionTitle'),
    t('retentionDescriptionShort'),
    value(retention ? t('retentionValue', { days: retention.episodeRetentionDays }) : '—', { chevron: true }),
    detail(
      React.createElement('p', { className: 'ch-row-body' }, t('retentionDescription')),
      controls(
        React.createElement('label', { className: 'ch-field-label' },
          t('observationsHours'),
          React.createElement('input', {
            className: 'ch-input ch-input-small', type: 'number', inputMode: 'numeric',
            min: RETENTION_BOUNDS.observationRetentionHours.min,
            max: RETENTION_BOUNDS.observationRetentionHours.max,
            step: 1, value: observationHours,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              setObservationHours(event.target.value)
            },
          }),
        ),
        React.createElement('label', { className: 'ch-field-label' },
          t('episodesDays'),
          React.createElement('input', {
            className: 'ch-input ch-input-small', type: 'number', inputMode: 'numeric',
            min: RETENTION_BOUNDS.episodeRetentionDays.min,
            max: RETENTION_BOUNDS.episodeRetentionDays.max,
            step: 1, value: episodeDays,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              setEpisodeDays(event.target.value)
            },
          }),
        ),
        React.createElement('button', {
          type: 'button', className: 'ch-button',
          disabled: pending || !retention,
          onClick: () => { void save() },
        }, t('save')),
      ),
      feedbackNode(feedback),
    ),
  )
}

export type DeleteHistoryPreset = 'ten-minutes' | 'hour' | 'day' | 'all'

export function deleteHistoryRequest(
  preset: DeleteHistoryPreset,
  nowMs: number,
): DeleteHistoryRequest {
  if (preset === 'all') return { scope: { kind: 'all' } }
  const durationMs = preset === 'ten-minutes'
    ? 10 * 60_000
    : preset === 'hour'
      ? 60 * 60_000
      : 24 * 60 * 60_000
  return {
    scope: {
      kind: 'time-range',
      startMs: Math.max(0, nowMs - durationMs),
      endMs: nowMs,
    },
  }
}

export function DeleteHistoryRow({
  t, store,
}: SettingsRowProps): React.ReactElement {
  const [confirming, setConfirming] = React.useState<DeleteHistoryPreset>()
  const [pending, setPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback>()

  const labels: Record<DeleteHistoryPreset, string> = {
    'ten-minutes': t('clearLastTenMinutes'),
    hour: t('clearLastHour'),
    day: t('clearLastDay'),
    all: t('clearAll'),
  }

  const remove = async (preset: DeleteHistoryPreset): Promise<void> => {
    setPending(true)
    setFeedback(undefined)
    try {
      await store.deleteHistory(deleteHistoryRequest(preset, Date.now()))
      setConfirming(undefined)
      setFeedback({ kind: 'success', text: t('historyDeleted') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPending(false)
    }
  }

  return disclosure(
    'trash',
    t('deleteTitle'),
    t('deleteDescriptionShort'),
    value('', { chevron: true }),
    detail(
      React.createElement('p', { className: 'ch-row-body' }, t('deleteRangePrompt')),
      React.createElement(
        'div', { className: 'ch-delete-ranges' },
        ...(['ten-minutes', 'hour', 'day', 'all'] as const).map(preset =>
          React.createElement('button', {
            type: 'button',
            className: preset === 'all'
              ? 'ch-button ch-range-button ch-button-danger'
              : 'ch-button ch-range-button',
            disabled: pending,
            onClick: () => { setConfirming(preset) },
          }, labels[preset])),
      ),
      confirming
        ? React.createElement(
            'div', { className: 'ch-delete-confirm', role: 'group' },
            React.createElement('span', { className: 'ch-row-body' },
              t('confirmClearRange', { range: labels[confirming] })),
            React.createElement('button', {
              type: 'button', className: 'ch-button ch-button-danger',
              disabled: pending, onClick: () => { void remove(confirming) },
            }, t('confirmClearRange', { range: labels[confirming] })),
            React.createElement('button', {
              type: 'button', className: 'ch-button', disabled: pending,
              onClick: () => { setConfirming(undefined) },
            }, t('cancel')),
          )
        : null,
      feedbackNode(feedback),
    ),
    true,
  )
}

export type CompanionUiStatus = 'connected' | 'configured' | 'setup' | 'unavailable'

export function companionUiStatus(
  companion: ComputerHistoryState['companion'] | undefined,
): CompanionUiStatus {
  if (!companion?.listening) return 'unavailable'
  if (companion.lastSeenAtMs !== undefined) return 'connected'
  if (companion.paired) return 'configured'
  return 'setup'
}

function settingsRelativeAge(
  t: HistoryTranslate,
  atMs: number,
  nowMs = Date.now(),
): string {
  const elapsed = Math.max(0, nowMs - atMs)
  if (elapsed < 60_000) return t('justNow')
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return t('minutesAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('hoursAgo', { hours })
  return t('daysAgo', { days: Math.floor(hours / 24) })
}

export function CompanionRow({
  t, store, snapshot,
}: SettingsRowProps): React.ReactElement {
  const [pending, setPending] = React.useState(false)
  const [token, setToken] = React.useState<string>()
  const [feedback, setFeedback] = React.useState<Feedback>()
  const [setup, setSetup] = React.useState<BrowserCompanionSetup>()
  const [setupError, setSetupError] = React.useState<string>()
  const companion = snapshot.state?.companion

  React.useEffect(() => {
    let disposed = false
    void historyApi.getCompanionSetup().then(setupResult => {
      if (!disposed) setSetup(setupResult)
    }).catch(cause => {
      if (!disposed) setSetupError(failureText(t, cause))
    })
    return () => { disposed = true }
  }, [t])

  const createPairingToken = async (): Promise<void> => {
    setPending(true)
    setToken(undefined)
    setFeedback(undefined)
    try {
      const result = await store.rotatePairing()
      setToken(result.token)
      setFeedback({ kind: 'success', text: t('pairingCreated') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPending(false)
    }
  }

  const status = companionUiStatus(companion)
  const companionValue = status === 'connected'
    ? t('companionConnected')
    : status === 'configured'
      ? t('companionConfigured')
      : status === 'setup'
        ? t('companionWaiting')
        : t('companionUnavailableShort')

  const receiverText = companion?.listening
    ? t(
        companion.paired
          ? 'companionListeningPaired'
          : 'companionListeningUnpaired',
        { port: companion.port ?? '—' },
      )
    : t('companionUnavailable')

  return disclosure(
    'browser',
    t('companionTitle'),
    t('companionDescriptionShort'),
    value(companionValue, { connected: status === 'connected', chevron: true }),
    detail(
      React.createElement('p', { className: 'ch-row-body' }, receiverText),
      React.createElement('p', { className: 'ch-row-body' }, t('companionDescription')),
      React.createElement(
        'div', { className: 'ch-browser-setup' },
        React.createElement(
          'section', { className: 'ch-setup-step' },
          React.createElement('h4', null, t('browserInstallTitle')),
          React.createElement('p', { className: 'ch-row-body' }, t('browserInstallDescription')),
          setup?.chromium.available && setup.chromium.extensionPath
            ? React.createElement(
                'div', { className: 'ch-extension-path' },
                React.createElement('span', null, t('browserExtensionFolder')),
                React.createElement('code', null, setup.chromium.extensionPath),
              )
            : setupError
              ? React.createElement('p', { className: 'ch-feedback ch-feedback-error', role: 'alert' }, setupError)
              : setup === undefined
                ? React.createElement('span', { className: 'ch-skeleton-line ch-skeleton-medium', 'aria-hidden': true })
                : React.createElement('p', { className: 'ch-feedback ch-feedback-error' }, t('browserExtensionMissing')),
        ),
        React.createElement(
          'section', { className: 'ch-setup-step' },
          React.createElement('h4', null, t('browserPairTitle')),
          React.createElement('p', { className: 'ch-row-body' }, t('browserPairDescription')),
          React.createElement('p', { className: 'ch-row-body' },
            companion?.lastSeenAtMs !== undefined
              ? t('browserLastConnected', {
                  when: settingsRelativeAge(t, companion.lastSeenAtMs),
                })
              : t('browserNeverConnected')),
          controls(React.createElement('button', {
            type: 'button', className: 'ch-button',
            disabled: pending || !companion?.listening,
            onClick: () => { void createPairingToken() },
          }, companion?.paired ? t('replacePairingToken') : t('createPairingToken'))),
          feedbackNode(feedback),
          token
            ? React.createElement(
                'div', { className: 'ch-token-block', role: 'status' },
                React.createElement('p', { className: 'ch-row-body' }, t('pairingTokenOnce')),
                React.createElement('pre', { className: 'ch-code' }, token),
              )
            : null,
        ),
      ),
    ),
  )
}

export function AboutRow({ t, snapshot }: SettingsRowProps): React.ReactElement {
  const { state } = snapshot
  return disclosure(
    'info',
    t('aboutTitle'),
    t('aboutDescriptionShort'),
    value('', { chevron: true }),
    detail(
      state
        ? React.createElement('p', { className: 'ch-row-body' }, t('aboutState', {
            capture: captureLabel(t, state.capture),
            accessibility: t(state.accessibilityTrusted
              ? 'accessibilityGranted'
              : 'accessibilityRequired'),
            collector: state.collector?.version ?? '—',
          }))
        : React.createElement('p', { className: 'ch-row-body' }, t('stateUnavailableRow')),
      React.createElement('p', { className: 'ch-row-body' }, t('privacyLocal')),
    ),
  )
}
