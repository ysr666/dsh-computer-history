import React from 'react'
import type {
  HistoryControlSnapshot,
  HistoryControlStore,
} from './store.js'
import type { HistoryTranslate } from './locale.js'
import { failureText } from './locale.js'
import {
  AboutRow,
  ApplicationsRow,
  CompanionRow,
  DataRow,
  DeleteHistoryRow,
  EditorCompanionRow,
  RecordingRow,
  RetentionRow,
} from './settings-rows.js'

export interface SettingsPageOptions {
  readonly store: HistoryControlStore
}

interface SettingsComponentProps {
  readonly t: HistoryTranslate
}

export type SettingsViewMode = 'loading' | 'error' | 'ready'

export function settingsViewMode(
  snapshot: Pick<HistoryControlSnapshot, 'status'>,
): SettingsViewMode {
  if (snapshot.status === 'error') return 'error'
  if (snapshot.status === 'idle' || snapshot.status === 'loading') return 'loading'
  return 'ready'
}

export function createSettingsPage({
  store,
}: SettingsPageOptions): (props: SettingsComponentProps) => React.ReactElement {
  return function SettingsPage({ t }: SettingsComponentProps): React.ReactElement {
    const snapshot = React.useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    )
    React.useEffect(() => {
      void store.load().catch(() => {})
    }, [])

    const mode = settingsViewMode(snapshot)
    if (mode === 'loading') {
      return React.createElement(
        'ul', { className: 'ch-settings-list ch-settings-loading', 'aria-busy': true },
        React.createElement('span', {
          className: 'ch-visually-hidden', role: 'status',
        }, t('loadingSettings')),
        ...Array.from({ length: 8 }, (_, index) => React.createElement(
          'li', { className: 'ch-settings-item', key: index, 'aria-hidden': true },
          React.createElement(
            'div', { className: 'ch-settings-line' },
            React.createElement('span', { className: 'ch-settings-skeleton-icon' }),
            React.createElement(
              'span', { className: 'ch-skeleton-copy' },
              React.createElement('span', { className: 'ch-skeleton-line ch-skeleton-medium' }),
              React.createElement('span', { className: 'ch-skeleton-line ch-skeleton-small' }),
            ),
            React.createElement('span', { className: 'ch-skeleton-line ch-skeleton-tiny' }),
          ),
        )),
      )
    }

    if (mode === 'error') {
      return React.createElement(
        'section', { className: 'ch-state-card ch-settings-state', role: 'alert' },
        React.createElement('div', { className: 'ch-state-mark', 'aria-hidden': true }, '!'),
        React.createElement(
          'div', { className: 'ch-state-copy' },
          React.createElement('h2', null, t('historyUnavailableTitle')),
          // The store keeps the raw cause for logs; the view is where it becomes copy.
          React.createElement('p', { className: 'ch-muted' }, failureText(t, snapshot.error)),
        ),
        React.createElement('button', {
          type: 'button', className: 'ch-button',
          onClick: () => { void store.reload().catch(() => {}) },
        }, t('retry')),
      )
    }

    const props = { t, store, snapshot }
    return React.createElement(
      'ul', { className: 'ch-settings-list' },
      React.createElement(RecordingRow, props),
      React.createElement(ApplicationsRow, props),
      React.createElement(RetentionRow, props),
      React.createElement(CompanionRow, props),
      React.createElement(EditorCompanionRow, props),
      React.createElement(DataRow, props),
      React.createElement(DeleteHistoryRow, props),
      React.createElement(AboutRow, props),
    )
  }
}
