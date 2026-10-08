import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {
  PluginConfigViewProps,
  PluginDetailProps,
  PluginsSubject,
} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  COMPUTER_HISTORY_PACKAGE,
  COMPUTER_HISTORY_PANEL_ID,
} from './plugin-navigation.js'
import {
  HISTORY_LOCALE_NS,
  type HistoryTranslate,
} from './locale.js'
import type {
  HistoryControlSnapshot,
  HistoryControlStore,
} from './store.js'

interface LocalizedProps {
  readonly t: HistoryTranslate
}

export function isComputerHistoryBundleSubject(subject: PluginsSubject): boolean {
  return subject.kind === 'bundle' && subject.pkg.name === COMPUTER_HISTORY_PACKAGE
}

function pluginRecordingState(
  snapshot: HistoryControlSnapshot,
  t: HistoryTranslate,
): string {
  if (snapshot.state?.capture === 'running') return t('settingOn')
  if (snapshot.state?.capture === 'paused') return t('settingPaused')
  return t('settingUnavailable')
}

function createPluginDetailAction(
  openHistory: () => void,
): (props: PluginDetailProps & LocalizedProps) => React.ReactElement | null {
  return function ComputerHistoryPluginAction({
    subject,
    t,
  }: PluginDetailProps & LocalizedProps): React.ReactElement | null {
    if (!isComputerHistoryBundleSubject(subject)) return null
    return React.createElement('button', {
      type: 'button',
      className: 'ch-button ch-plugin-detail-action',
      onClick: openHistory,
    }, t('pluginDetailOpen'))
  }
}

function createPluginBundleConfig(
  store: HistoryControlStore,
): (props: PluginConfigViewProps & LocalizedProps) => React.ReactElement | null {
  return function ComputerHistoryBundleConfig({
    view,
    t,
  }: PluginConfigViewProps & LocalizedProps): React.ReactElement | null {
    const snapshot = React.useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    )

    React.useEffect(() => {
      if (snapshot.status === 'idle') void store.load().catch(() => {})
    }, [snapshot.status])

    if (view !== 'page') return null
    const running = snapshot.state?.capture === 'running'

    return React.createElement(
      'section',
      { className: 'ch-plugin-config' },
      React.createElement(
        'div',
        { className: 'ch-plugin-config-head' },
        React.createElement('span', {
          className: running
            ? 'ch-settings-status-dot ch-settings-status-dot-success'
            : 'ch-settings-status-dot',
          'aria-hidden': true,
        }),
        React.createElement(
          'span',
          { className: 'ch-plugin-config-copy' },
          React.createElement('strong', null, t('recordingTitle')),
          React.createElement('span', null, pluginRecordingState(snapshot, t)),
        ),
      ),
      React.createElement('p', { className: 'ch-row-body' }, t('pluginDetailBody')),
    )
  }
}

export function applyPluginManagerSurfaces(
  ctx: Context,
  store: HistoryControlStore,
): void {
  const openHistory = (): void => {
    ctx.layout.selectPanel(COMPUTER_HISTORY_PANEL_ID)
  }
  const DetailAction = createPluginDetailAction(openHistory)
  const BundleConfig = createPluginBundleConfig(store)

  ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions',
    id: 'computer-history.open',
    locale: HISTORY_LOCALE_NS,
  }, DetailAction))

  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: COMPUTER_HISTORY_PACKAGE,
    locale: HISTORY_LOCALE_NS,
  }, BundleConfig))
}
