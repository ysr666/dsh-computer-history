import React from 'react'
import type {
  BrowserCompanionSetup,
  ComputerHistoryState,
  DeleteHistoryRequest,
  EditorCompanionInstallCapability,
  PolicySnapshot,
  RedactionPreview,
  RedactionReason,
} from '../shared/index.js'
import { COMPANION_BUNDLE_ID } from '../shared/constants.js'
import { RETENTION_BOUNDS } from '../shared/audit.js'
import { historyApi } from './api.js'
import { friendlyAppName } from './episode-subject.js'
import { ApplicationIcon } from './app-identity.js'
import { downloadHistoryRoute } from './download.js'
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


function redactionReasonText(t: HistoryTranslate, reason: RedactionReason): string {
  switch (reason) {
    case 'built-in-protected-app': return t('privacyReasonBuiltIn')
    case 'policy-disallowed': return t('privacyReasonPolicy')
    case 'secure-path': return t('privacyReasonSecurePath')
    case 'unreadable-resource': return t('privacyReasonUnreadable')
    case 'protected-title': return t('privacyReasonProtectedTitle')
    case 'protected-metadata': return t('privacyReasonProtectedMetadata')
    case 'browser-unpaired': return t('privacyReasonBrowserUnpaired')
    case 'unlocatable-file-name': return t('privacyReasonUnlocatable')
  }
}

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

type SettingsIconName = 'record' | 'apps' | 'clock' | 'browser' | 'editor' | 'data' | 'trash' | 'info'

const SETTINGS_ICON_PATHS: Record<SettingsIconName, string> = {
  record: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  browser: 'M4 5h16v14H4zM4 9h16M7 7h.01M10 7h.01',
  editor: 'M4 5h16v11H4zM8 20h8M12 16v4',
  data: 'M5 5h14v14H5zM9 9h6M9 13h6M9 17h4',
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
  const recoverable = state?.enabled === true
    && (state.capture === 'stopped' || state.capture === 'degraded')

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

  const retryRecording = async (): Promise<void> => {
    if (!recoverable) return
    setPending(true)
    setFeedback(undefined)
    try {
      await store.recover()
      setFeedback({ kind: 'success', text: t('recordingFeedback') })
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
    state?.reason || feedback || recoverable
      ? detail(
          state?.reason
            ? React.createElement('p', { className: 'ch-row-body' },
                t('whyReason', { reason: reasonText(t, state.reason) }))
            : null,
          recoverable
            ? controls(React.createElement('button', {
                type: 'button', className: 'ch-button', disabled: pending,
                onClick: () => { void retryRecording() },
              }, t(pending ? 'recoveringRecording' : 'retryRecording')))
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
  const [installedApps, setInstalledApps] = React.useState<readonly {
    readonly bundleId: string
    readonly name: string
  }[]>()
  const [inventoryAvailable, setInventoryAvailable] = React.useState<boolean>()
  const { policy } = snapshot
  const userRules = (policy?.rules ?? []).filter(rule =>
    !rule.builtIn
    && rule.dimension === 'app'
    && rule.pattern !== COMPANION_BUNDLE_ID,
  )
  const allowed = userRules.filter(rule => rule.action === 'allow')
  const denied = userRules.filter(rule => rule.action !== 'allow')
  const visibleAllowed = showAll ? allowed : allowed.slice(0, 5)
  const allowedIds = new Set(allowed.map(rule => rule.pattern))
  const installedNames = new Map(
    (installedApps ?? []).map(app => [app.bundleId, app.name]),
  )
  const availableApps = (installedApps ?? [])
    .filter(app => !allowedIds.has(app.bundleId))

  React.useEffect(() => {
    let disposed = false
    void historyApi.getSupportedApplications()
      .then(result => {
        if (disposed) return
        setInventoryAvailable(result.available)
        setInstalledApps(result.applications)
      })
      .catch(() => {
        if (!disposed) setInventoryAvailable(false)
      })
    return () => { disposed = true }
  }, [])

  const allowApp = async (appId: string, clearManual = false): Promise<void> => {
    if (!appId || !policy) return
    setPending(true)
    setFeedback(undefined)
    try {
      await store.replacePolicy({
        mode: 'include-only', rules: allowRuleUpdate(policy, appId),
      })
      if (clearManual) setBundleId('')
      setFeedback({ kind: 'success', text: t('appAllowedFeedback') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPending(false)
    }
  }

  const addApp = async (): Promise<void> => {
    await allowApp(bundleId.trim(), true)
  }

  const stopRecordingApp = async (appId: string): Promise<void> => {
    if (!policy) return
    setPending(true)
    setFeedback(undefined)
    try {
      const rules = policy.rules.filter(rule =>
        !(rule.dimension === 'app' && rule.pattern === appId),
      )
      await store.replacePolicy({ mode: 'include-only', rules })
      setFeedback({ kind: 'success', text: t('appStoppedFeedback') })
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
              React.createElement(ApplicationIcon, {
                app: friendlyAppName(rule.pattern, installedNames.get(rule.pattern)),
                bundleId: rule.pattern,
                compact: true,
              }),
              React.createElement(
                'span', { className: 'ch-app-rule-copy' },
                React.createElement('span', { className: 'ch-app-rule-title' }, friendlyAppName(rule.pattern, installedNames.get(rule.pattern))),
              ),
              React.createElement('button', {
                type: 'button', className: 'ch-button', disabled: pending,
                onClick: () => { void stopRecordingApp(rule.pattern) },
              }, t('stopRecordingApp')),
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
      inventoryAvailable === undefined
        ? React.createElement('p', { className: 'ch-row-body' }, t('applicationsScanning'))
        : inventoryAvailable && availableApps.length > 0
          ? React.createElement(
              'section', { className: 'ch-setup-step' },
              React.createElement('h4', null, t('applicationsAvailableTitle')),
              React.createElement('p', { className: 'ch-row-body' }, t('applicationsAvailableBody')),
              React.createElement(
                'ul', { className: 'ch-list' },
                ...availableApps.map(app => React.createElement(
                  'li', { key: app.bundleId },
                  React.createElement(ApplicationIcon, {
                    app: friendlyAppName(app.bundleId, app.name),
                    bundleId: app.bundleId,
                    compact: true,
                  }),
                  React.createElement(
                    'span', { className: 'ch-app-rule-copy' },
                    React.createElement('span', { className: 'ch-app-rule-title' }, friendlyAppName(app.bundleId, app.name)),
                  ),
                  React.createElement('button', {
                    type: 'button', className: 'ch-button', disabled: pending || !policy,
                    onClick: () => { void allowApp(app.bundleId) },
                  }, t('addApplication')),
                )),
              ),
            )
          : inventoryAvailable
            ? React.createElement('p', { className: 'ch-row-body' }, t('applicationsAllAdded'))
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

  const setPreset = async (days: number): Promise<void> => {
    if (!retention) return
    setPending(true)
    setFeedback(undefined)
    try {
      await store.setRetention({
        observationRetentionHours: retention.observationRetentionHours,
        episodeRetentionDays: days,
      })
      setFeedback({ kind: 'success', text: t('saved') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPending(false)
    }
  }

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
      React.createElement('p', { className: 'ch-row-body' }, t('retentionPresetsTitle')),
      React.createElement(
        'div', { className: 'ch-delete-ranges' },
        ...([7, 30, 90, 365] as const).map(days => React.createElement('button', {
          type: 'button',
          className: retention?.episodeRetentionDays === days
            ? 'ch-button ch-range-button ch-range-button-selected'
            : 'ch-button ch-range-button',
          'aria-pressed': retention?.episodeRetentionDays === days,
          disabled: pending || !retention,
          onClick: () => { void setPreset(days) },
        }, t('retentionValue', { days }))),
      ),
      React.createElement('p', { className: 'ch-row-body' }, t('retentionDescription')),
      React.createElement(
        'details', { className: 'ch-manual-add' },
        React.createElement('summary', null, t('retentionAdvanced')),
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

export function DataRow({ t, store, snapshot }: SettingsRowProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [exportPending, setExportPending] = React.useState(false)
  const [importPending, setImportPending] = React.useState(false)
  const [selectedImport, setSelectedImport] = React.useState<{
    readonly name: string
    readonly document: unknown
  }>()
  const [privacyApps, setPrivacyApps] = React.useState<readonly { readonly bundleId: string, readonly name: string }[]>([])
  const [privacyBundleId, setPrivacyBundleId] = React.useState('')
  const [privacyPreview, setPrivacyPreview] = React.useState<RedactionPreview>()
  const [privacyPending, setPrivacyPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback>()

  React.useEffect(() => {
    let disposed = false
    void historyApi.getRedactionApplications()
      .then(recorded => {
        if (disposed) return
        const apps = recorded
          .map(app => ({
            bundleId: app.bundleId,
            name: friendlyAppName(app.bundleId, app.displayName),
          }))
          .toSorted((left, right) => left.name.localeCompare(right.name))
        setPrivacyApps(apps)
        setPrivacyBundleId(current => current && apps.some(app => app.bundleId === current)
          ? current
          : apps[0]?.bundleId ?? '')
        setPrivacyPreview(undefined)
      })
      .catch(() => {
        if (!disposed) setPrivacyApps([])
      })
    return () => { disposed = true }
  }, [snapshot.historyRevision])

  const checkPrivacy = async (): Promise<void> => {
    if (!privacyBundleId) return
    setPrivacyPending(true)
    setFeedback(undefined)
    try {
      setPrivacyPreview(await historyApi.getRedactionPreview(`app:${privacyBundleId}`))
    } catch (cause) {
      setPrivacyPreview(undefined)
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setPrivacyPending(false)
    }
  }

  const exportHistory = async (): Promise<void> => {
    setExportPending(true)
    setFeedback(undefined)
    try {
      await downloadHistoryRoute('/export')
      setFeedback({ kind: 'success', text: t('exportReady') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setExportPending(false)
    }
  }

  const selectImport = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setFeedback(undefined)
    try {
      setSelectedImport({
        name: file.name,
        document: JSON.parse(await file.text()) as unknown,
      })
    } catch {
      setSelectedImport(undefined)
      setFeedback({ kind: 'error', text: t('importInvalidJson') })
    }
  }

  const importHistory = async (): Promise<void> => {
    if (!selectedImport) return
    setImportPending(true)
    setFeedback(undefined)
    try {
      await store.importHistory(selectedImport.document)
      setSelectedImport(undefined)
      setFeedback({ kind: 'success', text: t('importComplete') })
    } catch {
      setFeedback({ kind: 'error', text: t('importFailed') })
    } finally {
      setImportPending(false)
    }
  }

  return disclosure(
    'data',
    t('dataTitle'),
    t('dataDescriptionShort'),
    value('', { chevron: true }),
    detail(
      React.createElement(
        'section', { className: 'ch-setup-step' },
        React.createElement('h4', null, t('privacyCheck')),
        React.createElement('p', { className: 'ch-row-body' }, t('privacyCheckBody')),
        privacyApps.length > 0
          ? React.createElement(
              React.Fragment,
              null,
              controls(
                React.createElement(
                  'select',
                  {
                    className: 'ch-input ch-privacy-select',
                    value: privacyBundleId,
                    'aria-label': t('privacyCheckChooseApp'),
                    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                      setPrivacyBundleId(event.target.value)
                      setPrivacyPreview(undefined)
                    },
                  },
                  ...privacyApps.map(app => React.createElement(
                    'option', { key: app.bundleId, value: app.bundleId }, app.name,
                  )),
                ),
                React.createElement('button', {
                  type: 'button', className: 'ch-button', disabled: privacyPending || !privacyBundleId,
                  onClick: () => { void checkPrivacy() },
                }, privacyPending ? t('privacyCheckRunning') : t('privacyCheckRun')),
              ),
              privacyPreview
                ? React.createElement(
                    'div', { className: 'ch-privacy-result', role: 'status' },
                    React.createElement('p', { className: 'ch-row-body' },
                      privacyPreview.excluded.length === 0
                        ? t('privacyCheckKept', { checked: privacyPreview.checked })
                        : t('privacyCheckExcluded', {
                            checked: privacyPreview.checked,
                            excluded: privacyPreview.excluded.length,
                          })),
                    privacyPreview.excluded.length > 0
                      ? React.createElement(
                          'ul', { className: 'ch-privacy-reasons' },
                          ...Object.entries(
                            privacyPreview.excluded.reduce<Record<string, number>>((counts, entry) => {
                              counts[entry.reason] = (counts[entry.reason] ?? 0) + 1
                              return counts
                            }, {}),
                          ).map(([reason, count]) => React.createElement(
                            'li', { key: reason }, t('privacyReasonCount', {
                              reason: redactionReasonText(t, reason as RedactionReason),
                              count,
                            }),
                          )),
                        )
                      : null,
                    React.createElement(
                      'details', { className: 'ch-inspector' },
                      React.createElement('summary', null, t('technicalDetails')),
                      React.createElement('p', { className: 'ch-muted' }, t('privacyTechnicalMeta', {
                        revision: privacyPreview.policyRevision,
                        bundles: privacyPreview.rulesInForce.protectedBundleIds.length,
                        patterns: privacyPreview.rulesInForce.protectedPatterns.length,
                      })),
                    ),
                  )
                : null,
            )
          : React.createElement('p', { className: 'ch-row-body' }, t('privacyCheckNoHistory')),
      ),
      React.createElement(
        'section', { className: 'ch-setup-step' },
        React.createElement('h4', null, t('exportHistory')),
        React.createElement('p', { className: 'ch-row-body' }, t('exportHistoryBody')),
        controls(React.createElement('button', {
          type: 'button', className: 'ch-button', disabled: exportPending,
          onClick: () => { void exportHistory() },
        }, exportPending ? t('exportingHistory') : t('exportHistory'))),
      ),
      React.createElement(
        'section', { className: 'ch-setup-step' },
        React.createElement('h4', null, t('importHistory')),
        React.createElement('p', { className: 'ch-row-body' }, t('importHistoryBody')),
        React.createElement('input', {
          ref: inputRef,
          type: 'file',
          accept: '.json,application/json',
          className: 'ch-visually-hidden',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { void selectImport(event) },
        }),
        controls(
          React.createElement('button', {
            type: 'button', className: 'ch-button', disabled: importPending,
            onClick: () => { inputRef.current?.click() },
          }, t('importHistory')),
          selectedImport
            ? React.createElement('span', { className: 'ch-row-body' },
                t('importSelected', { name: selectedImport.name }))
            : null,
          selectedImport
            ? React.createElement('button', {
                type: 'button', className: 'ch-button', disabled: importPending,
                onClick: () => { void importHistory() },
              }, importPending ? t('importingHistory') : t('confirmImport'))
            : null,
        ),
      ),
      feedbackNode(feedback),
    ),
  )
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
  if (companion.browserLastSeenAtMs !== undefined) return 'connected'
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
        ? t('companionDevelopmentOnly')
        : t('companionUnavailableShort')

  const receiverText = companion?.listening
    ? t(companion.paired
        ? 'companionListeningPaired'
        : 'companionListeningUnpaired')
    : t('companionUnavailable')

  return disclosure(
    'browser',
    t('companionTitle'),
    t('companionDescriptionShort'),
    value(companionValue, { connected: status === 'connected', chevron: true }),
    detail(
      React.createElement('p', { className: 'ch-row-body' }, t('companionDescription')),
      React.createElement(
        'div', { className: 'ch-setup-status' },
        React.createElement('span', {
          className: status === 'connected'
            ? 'ch-settings-status-dot ch-settings-status-dot-success'
            : 'ch-settings-status-dot',
          'aria-hidden': true,
        }),
        React.createElement('span', null, receiverText),
        React.createElement('span', { className: 'ch-setup-status-age' },
          companion?.browserLastSeenAtMs !== undefined
            ? t('browserLastConnected', {
                when: settingsRelativeAge(t, companion.browserLastSeenAtMs),
              })
            : t('browserNeverConnected')),
      ),
      status === 'connected'
        ? null
        : React.createElement('p', { className: 'ch-row-body' }, t('browserProductionUnavailable')),
      React.createElement(
        'details', { className: 'ch-manual-add' },
        React.createElement('summary', null, t('browserDeveloperSetup')),
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
    ),
  )
}

export function editorCompanionConnected(
  capability: EditorCompanionInstallCapability | undefined,
  editorLastSeenAtMs: number | undefined,
): editorLastSeenAtMs is number {
  return capability?.installed === true && editorLastSeenAtMs !== undefined
}

export function editorCompanionAwaitingFirstContact(
  capability: EditorCompanionInstallCapability | undefined,
  editorPaired: boolean,
  editorLastSeenAtMs: number | undefined,
): boolean {
  return capability?.installed === true
    && editorPaired
    && editorLastSeenAtMs === undefined
}

export function EditorCompanionRow({
  t, store, snapshot,
}: SettingsRowProps): React.ReactElement {
  const [capability, setCapability] = React.useState<EditorCompanionInstallCapability>()
  const [pending, setPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback>()
  const editorLastSeenAtMs = snapshot.state?.companion?.editorLastSeenAtMs
  const editorPaired = snapshot.state?.companion?.editorPaired === true
  const connected = editorCompanionConnected(capability, editorLastSeenAtMs)
  const awaitingFirstContact = editorCompanionAwaitingFirstContact(
    capability,
    editorPaired,
    editorLastSeenAtMs,
  )

  React.useEffect(() => {
    let disposed = false
    void historyApi.getEditorCompanionInstallCapability()
      .then(result => { if (!disposed) setCapability(result) })
      .catch(() => {
        if (!disposed) setCapability({
          available: false,
          installed: false,
          reason: 'code-cli-unavailable',
        })
      })
    return () => { disposed = true }
  }, [])

  React.useEffect(() => {
    if (!awaitingFirstContact) return
    let disposed = false
    let attempts = 0
    let timer: number | undefined

    const schedule = (): void => {
      timer = window.setTimeout(() => {
        attempts += 1
        void store.reload()
          .catch(() => {})
          .finally(() => {
            if (!disposed && attempts < 15) schedule()
          })
      }, 1_000)
    }

    schedule()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [awaitingFirstContact, store])

  const installOrConnect = async (): Promise<void> => {
    const wasUpdate = capability?.updateAvailable === true
    setPending(true)
    setFeedback(undefined)
    try {
      const result = await historyApi.installEditorCompanion()
      if (
        (result.status === 'installed' || result.status === 'already-installed')
        && result.configured === true
      ) {
        setCapability(await historyApi.getEditorCompanionInstallCapability())
        await store.reload()
        setFeedback({
          kind: 'success',
          text: t(wasUpdate
            ? 'editorCompanionUpdatedFeedback'
            : 'editorCompanionConfiguredFeedback'),
        })
      } else if (result.status === 'installed' || result.status === 'already-installed') {
        setCapability(await historyApi.getEditorCompanionInstallCapability())
        setFeedback({ kind: 'error', text: t('editorCompanionPairingFailed') })
      } else {
        setFeedback({ kind: 'error', text: t('editorCompanionInstallFailed') })
      }
    } catch {
      setFeedback({ kind: 'error', text: t('editorCompanionInstallFailed') })
    } finally {
      setPending(false)
    }
  }

  const right = capability?.updateAvailable
    ? t('editorCompanionUpdateAvailable')
    : connected
      ? t('editorCompanionConnected')
      : capability?.installed && editorPaired
        ? t('editorCompanionWaiting')
        : capability?.installed
          ? t('editorCompanionInstalled')
          : capability?.available
            ? t('editorCompanionReady')
            : capability === undefined
              ? '—'
              : t('editorCompanionUnavailable')

  return disclosure(
    'editor',
    t('editorCompanionTitle'),
    t('editorCompanionDescriptionShort'),
    value(right, { connected: connected && capability?.updateAvailable !== true, chevron: true }),
    detail(
      React.createElement('p', { className: 'ch-row-body' },
        capability?.updateAvailable
          ? t('editorCompanionUpdateBody')
          : connected
            ? t('editorCompanionConnectedBody', {
              when: settingsRelativeAge(t, editorLastSeenAtMs),
            })
          : capability?.installed && editorPaired
            ? t('editorCompanionWaitingBody')
            : capability?.installed
              ? t('editorCompanionInstalledBody')
              : capability?.available
                ? t('editorCompanionAvailableBody')
                : t('editorCompanionUnavailableBody')),
      capability?.available && (!connected || capability.updateAvailable === true)
        ? controls(React.createElement('button', {
            type: 'button', className: 'ch-button', disabled: pending,
            onClick: () => { void installOrConnect() },
          }, pending
            ? t(capability.updateAvailable ? 'editorCompanionUpdating' : 'editorCompanionInstalling')
            : capability.updateAvailable
              ? t('editorCompanionUpdate')
              : capability.installed
                ? t('editorCompanionConnect')
                : t('editorCompanionInstall')))
        : null,
      capability?.reason
        ? React.createElement(
            'details', { className: 'ch-manual-add' },
            React.createElement('summary', null, t('diagnostics')),
            React.createElement('p', { className: 'ch-row-body' }, capability.reason),
          )
        : null,
      feedbackNode(feedback),
    ),
  )
}

export function AboutRow({ t, snapshot }: SettingsRowProps): React.ReactElement {
  const { state } = snapshot
  const [diagnosticsPending, setDiagnosticsPending] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback>()

  const downloadDiagnostics = async (): Promise<void> => {
    setDiagnosticsPending(true)
    setFeedback(undefined)
    try {
      await downloadHistoryRoute('/diagnostics')
      setFeedback({ kind: 'success', text: t('diagnosticsReady') })
    } catch (cause) {
      setFeedback({ kind: 'error', text: failureText(t, cause) })
    } finally {
      setDiagnosticsPending(false)
    }
  }

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
          }))
        : React.createElement('p', { className: 'ch-row-body' }, t('stateUnavailableRow')),
      React.createElement('p', { className: 'ch-row-body' }, t('privacyLocal')),
      state
        ? React.createElement(
            'details', { className: 'ch-manual-add' },
            React.createElement('summary', null, t('diagnostics')),
            React.createElement('p', { className: 'ch-row-body' }, t('collectorVersion', {
              collector: state.collector?.version ?? '—',
            })),
            React.createElement('p', { className: 'ch-row-body' }, t('diagnosticsPrivacyBody')),
            controls(React.createElement('button', {
              type: 'button', className: 'ch-button', disabled: diagnosticsPending,
              onClick: () => { void downloadDiagnostics() },
            }, diagnosticsPending ? t('downloadingDiagnostics') : t('downloadDiagnostics'))),
            feedbackNode(feedback),
          )
        : null,
    ),
  )
}
