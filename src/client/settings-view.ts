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
  DeleteHistoryRow,
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
      return React.createElement('p', {
        className: 'ch-row-body', role: 'status',
      }, t('loadingSettings'))
    }

    if (mode === 'error') {
      return React.createElement(
        'div', { className: 'ch-alert' },
        // The store keeps the raw cause for logs; the view is where it becomes copy.
        React.createElement('p', { role: 'alert' }, failureText(t, snapshot.error)),
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
      React.createElement(DeleteHistoryRow, props),
      React.createElement(CompanionRow, props),
      React.createElement(AboutRow, props),
    )
  }
}
