import type { Context } from '@deepseek-ai/cordis'
// Runtime module ids are the sibling client *package* ids (the ids the DSH
// client module loader registers and the ids our `dsh.client.inject` declares).
// Subpath ids such as `.../client` are not in the loader's require table.
import '@deepseek-ai/dsh-client-ui-renderer'
import '@deepseek-ai/dsh-client-ui-sidebar'
import '@deepseek-ai/dsh-client-ui-slots'
// Type-only imports carry the client-side contract augmentations (`ctx.slots`,
// sidebar/panel slot props, `MainPanelId`). They are erased at runtime, so the
// wrapped bundle never requires the unregistered `.../client` subpath ids.
import type * as _rendererClientTypes from '@deepseek-ai/dsh-client-ui-renderer/client'
import type * as _sidebarClientTypes from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import React, { useCallback, useEffect, useState } from 'react'
import type {
  ComputerHistoryState,
  EpisodeSummary,
  PolicySnapshot,
  WorkThread,
} from '../shared/index.js'
import { historyApiPath } from './api-route.js'

const PANEL_ID = 'computer-history' as MainPanelId

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(historyApiPath(path), init)
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

function HistoryIcon(): React.ReactElement {
  return React.createElement('span', { 'aria-hidden': true }, '◷')
}

function HistoryPage(): React.ReactElement {
  const [state, setState] = useState<ComputerHistoryState>()
  const [episodes, setEpisodes] = useState<readonly EpisodeSummary[]>([])
  const [threads, setThreads] = useState<readonly WorkThread[]>([])
  const [policy, setPolicy] = useState<PolicySnapshot>()
  const [bundleId, setBundleId] = useState('')
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [companionToken, setCompanionToken] = useState<string>()
  const [siteOrigin, setSiteOrigin] = useState('')
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextEpisodes, nextPolicy, nextThreads]
        = await Promise.all([
          api<ComputerHistoryState>('/state'),
          api<readonly EpisodeSummary[]>('/recent?limit=50'),
          api<PolicySnapshot>('/policy'),
          api<readonly WorkThread[]>('/threads?limit=20'),
        ])
      setState(nextState)
      setEpisodes(nextEpisodes)
      setPolicy(nextPolicy)
      setThreads(nextThreads)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const runAction = (
    action: () => Promise<void>,
  ): void => {
    void action().catch(cause => {
      setError(
        cause instanceof Error
          ? cause.message
          : String(cause),
      )
    })
  }

  const toggle = async (): Promise<void> => {
    if (!state?.enabled) return
    await api(
      state.capture === 'paused'
        ? '/resume'
        : '/pause',
      { method: 'POST' },
    )
    await refresh()
  }

  const clearAll = async (): Promise<void> => {
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true)
      return
    }

    await api('/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: { kind: 'all' },
      }),
    })
    setConfirmDeleteAll(false)
    await refresh()
  }

  const allowApp = async (): Promise<void> => {
    const value = bundleId.trim()
    if (!value || !policy) return
    const now = Date.now()
    const rules = policy.rules.filter(rule =>
      !(rule.dimension === 'app' && rule.pattern === value),
    )
    rules.push({
      id: ('app:' + value) as never,
      dimension: 'app', action: 'allow', matcher: 'exact', pattern: value,
      builtIn: false, createdAtMs: now, updatedAtMs: now,
    })
    await api('/policy', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'include-only', rules }),
    })
    setBundleId('')
    await refresh()
  }

  const forgetApp = async (): Promise<void> => {
    const value = bundleId.trim()
    if (!value || !policy) return
    const rules = policy.rules.filter(rule =>
      !(rule.dimension === 'app' && rule.pattern === value),
    )
    await api('/policy', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'include-only', rules }),
    })
    await api('/delete', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { kind: 'app', bundleId: value } }),
    })
    setBundleId('')
    await refresh()
  }

  const rotateCompanionToken = async (): Promise<void> => {
    // The token exists in clear only in this response: the Host keeps a digest
    // (ADR 0007), so this is the one moment it can be copied.
    const result = await api<{ token: string }>(
      '/pairing/rotate',
      { method: 'POST' },
    )
    setCompanionToken(result.token)
    await refresh()
  }

  const setSiteRule = async (action: 'allow' | 'deny'): Promise<void> => {
    const value = siteOrigin.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^/?#]+$/.test(value) || !policy) return
    const now = Date.now()
    const rules = policy.rules.filter(rule =>
      !(rule.dimension === 'resource' && rule.pattern === value),
    )
    rules.push({
      id: ('site:' + value) as never,
      dimension: 'resource',
      action,
      matcher: 'prefix',
      pattern: value,
      builtIn: false,
      createdAtMs: now,
      updatedAtMs: now,
    })
    await api('/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'include-only', rules }),
    })
    setSiteOrigin('')
    await refresh()
  }

  const companion = state?.companion

  const companionSection = React.createElement(
    'section',
    {
      style: {
        border: '1px solid #d0d0d0',
        borderRadius: 8,
        padding: 12,
        marginBottom: 20,
      },
    },
    React.createElement('h2', { style: { margin: '0 0 8px' } }, 'Browser companion'),
    React.createElement(
      'p',
      null,
      !companion
        ? 'Companion state unavailable on this Host.'
        : companion.listening
          ? `Listening on 127.0.0.1:${companion.port} · ${companion.paired ? 'paired' : 'not paired yet'}`
          : `Companion unavailable${companion.reason ? ': ' + companion.reason : ''}`,
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      React.createElement(
        'button',
        { type: 'button', onClick: () => { runAction(rotateCompanionToken) } },
        companion?.paired ? 'Rotate pairing token' : 'Create pairing token',
      ),
      companionToken
        ? React.createElement(
            'code',
            {
              style: {
                padding: '4px 8px',
                background: '#f2f2f2',
                borderRadius: 4,
                userSelect: 'all',
              },
            },
            companionToken,
          )
        : null,
    ),
    companionToken
      ? React.createElement(
          'p',
          { style: { color: '#555' } },
          'Copy this into the extension’s options now — only a digest is stored, so it cannot be shown again.',
        )
      : null,
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 } },
      React.createElement('input', {
        type: 'text',
        placeholder: 'https://example.com',
        value: siteOrigin,
        onChange: (event: { target: { value: string } }) => {
          setSiteOrigin(event.target.value)
        },
        style: { flex: 1, padding: 6 },
      }),
      React.createElement(
        'button',
        { type: 'button', onClick: () => { runAction(() => setSiteRule('allow')) } },
        'Allow site',
      ),
      React.createElement(
        'button',
        { type: 'button', onClick: () => { runAction(() => setSiteRule('deny')) } },
        'Deny site',
      ),
    ),
  )

  const threadSection = React.createElement(
    'section',
    { style: { marginBottom: 20 } },
    React.createElement('h2', { style: { margin: '0 0 8px' } }, 'Work threads'),
    threads.length === 0
      ? React.createElement(
          'p',
          { style: { color: '#555' } },
          'No threaded work yet: episodes need a workspace the Host can vouch for.',
        )
      : React.createElement(
          'ul',
          { style: { margin: 0, paddingLeft: 18 } },
          ...threads.map(thread => React.createElement(
            'li',
            { key: thread.threadKey, style: { marginBottom: 6 } },
            thread.summary,
            React.createElement(
              'span',
              { style: { color: '#666' } },
              ` (${thread.episodeCount} episode${thread.episodeCount === 1 ? '' : 's'}, ${thread.summaryObservationIds.length} citations)`,
            ),
          )),
        ),
  )

  return React.createElement(
    'main',
    { style: { padding: 24, maxWidth: 960, margin: '0 auto' } },
    React.createElement('h1', null, 'Computer History'),
    React.createElement(
      'p',
      null,
      state
        ? `Capture: ${state.capture} · Accessibility: ${state.accessibilityTrusted ? 'granted' : 'required'} · Raw retention: ${state.observationRetentionHours}h`
        : 'Loading…',
    ),
    error
      ? React.createElement('p', { role: 'alert' }, error)
      : null,
    state?.reason
      ? React.createElement(
          'p',
          null,
          'Status detail: ' + state.reason,
        )
      : null,
    companionSection,
    threadSection,
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 8, marginBottom: 20 } },
      React.createElement(
        'button',
        {
          type: 'button',
          disabled:
            !state?.enabled
            || (
              state.capture !== 'running'
              && state.capture !== 'paused'
            ),
          onClick: () => { runAction(toggle) },
        },
        !state?.enabled
          ? 'Capture disabled in plugin config'
          : state.capture === 'paused'
            ? 'Resume capture'
            : state.capture === 'running'
              ? 'Pause capture'
              : 'Capture unavailable',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => { runAction(clearAll) },
        },
        confirmDeleteAll
          ? 'Confirm delete all history'
          : 'Delete all history',
      ),
      confirmDeleteAll
        ? React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                setConfirmDeleteAll(false)
              },
            },
            'Cancel',
          )
        : null,
      React.createElement(
        'button',
        { type: 'button', onClick: () => { runAction(refresh) } },
        'Refresh',
      ),
    ),
    React.createElement('h2', null, 'Privacy & app access'),
    React.createElement('p', null,
      'Capture is include-only. Phase 1 accepts only supported metadata adapters (VS Code/Cursor, Terminal/iTerm, Preview, Finder); browsers and unknown apps fail closed before storage.'),
    React.createElement('input', {
      value: bundleId,
      placeholder: 'com.example.App',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setBundleId(event.target.value),
    }),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: () => { runAction(allowApp) },
      },
      'Allow app',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: () => { runAction(forgetApp) },
      },
      'Forget app',
    ),
    React.createElement('ul', null,
      ...(policy?.rules.filter(rule => rule.dimension === 'app' && rule.action === 'allow') ?? [])
        .map(rule => React.createElement('li', { key: rule.id }, rule.pattern))),
    React.createElement('h2', null, 'Recent work episodes'),
    ...episodes.map(episode => React.createElement(
      'article',
      {
        key: episode.id,
        style: {
          border: '1px solid currentColor',
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        },
      },
      React.createElement(
        'strong',
        null,
        episode.workspace?.title ?? 'Unanchored activity',
      ),
      React.createElement(
        'div',
        null,
        new Date(episode.startedAtMs).toLocaleString(),
        ' – ',
        new Date(episode.endedAtMs).toLocaleString(),
      ),
      React.createElement('pre', {
        style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      }, episode.summary),
    )),
  )
}

export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
  }, HistoryPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: 'Computer History',
  }, HistoryIcon))
}
