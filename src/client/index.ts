import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-client-ui-renderer/client'
import '@deepseek-ai/dsh-client-ui-sidebar/client'
import '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import React, { useCallback, useEffect, useState } from 'react'
import type { ComputerHistoryState, EpisodeSummary, PolicySnapshot } from '../shared/index.js'

const PANEL_ID = 'computer-history' as MainPanelId
const API = '/api/computer-history'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + path, init)
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

function HistoryIcon(): React.ReactElement {
  return React.createElement('span', { 'aria-hidden': true }, '◷')
}

function HistoryPage(): React.ReactElement {
  const [state, setState] = useState<ComputerHistoryState>()
  const [episodes, setEpisodes] = useState<readonly EpisodeSummary[]>([])
  const [policy, setPolicy] = useState<PolicySnapshot>()
  const [bundleId, setBundleId] = useState('')
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextEpisodes, nextPolicy] = await Promise.all([
        api<ComputerHistoryState>('/state'),
        api<readonly EpisodeSummary[]>('/recent?limit=50'),
        api<PolicySnapshot>('/policy'),
      ])
      setState(nextState)
      setEpisodes(nextEpisodes)
      setPolicy(nextPolicy)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const toggle = async (): Promise<void> => {
    await api(state?.capture === 'paused' ? '/resume' : '/pause', {
      method: 'POST',
    })
    await refresh()
  }

  const clearAll = async (): Promise<void> => {
    await api('/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { kind: 'all' } }),
    })
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
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 8, marginBottom: 20 } },
      React.createElement(
        'button',
        { type: 'button', onClick: () => { void toggle() } },
        state?.capture === 'paused' ? 'Resume capture' : 'Pause capture',
      ),
      React.createElement(
        'button',
        { type: 'button', onClick: () => { void clearAll() } },
        'Delete all history',
      ),
      React.createElement(
        'button',
        { type: 'button', onClick: () => { void refresh() } },
        'Refresh',
      ),
    ),
    React.createElement('h2', null, 'Privacy & app access'),
    React.createElement('p', null,
      'Capture is include-only. Only explicitly allowed bundle IDs can be persisted; secure fields and protected apps are rejected before storage.'),
    React.createElement('input', {
      value: bundleId,
      placeholder: 'com.example.App',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setBundleId(event.target.value),
    }),
    React.createElement('button', { type: 'button', onClick: () => { void allowApp() } }, 'Allow app'),
    React.createElement('button', { type: 'button', onClick: () => { void forgetApp() } }, 'Forget app'),
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
