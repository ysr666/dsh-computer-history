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
  EpisodeDetail,
  RetentionSettings,
  MinimisedSummaryPayload,
  TimelineDay,
  ResumeResolution,
  SemanticSummaryState,
  WorkThread,
} from '../shared/index.js'
import { describeProvenance } from '../shared/audit-view.js'
import { describeHealth } from '../shared/health.js'
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
  const [resumeQuery, setResumeQuery] = useState('')
  const [hint, setHint] = useState<ResumeResolution>()
  const [semantic, setSemantic] = useState<SemanticSummaryState>()
  const [timeline, setTimeline] = useState<readonly TimelineDay[]>([])
  const [retention, setRetention] = useState<RetentionSettings>()
  const [retentionHours, setRetentionHours] = useState('')
  const [retentionDays, setRetentionDays] = useState('')
  const [selected, setSelected] = useState<EpisodeDetail>()
  const [preview, setPreview] = useState<string>()
  const [policy, setPolicy] = useState<PolicySnapshot>()
  const [bundleId, setBundleId] = useState('')
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [companionToken, setCompanionToken] = useState<string>()
  const [copiedToken, setCopiedToken] = useState(false)
  const [siteOrigin, setSiteOrigin] = useState('')
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      const [
        nextState, nextEpisodes, nextPolicy, nextThreads, nextSemantics,
        nextTimeline,
        nextRetention,
      ] = await Promise.all([
          api<ComputerHistoryState>('/state'),
          api<readonly EpisodeSummary[]>('/recent?limit=50'),
          api<PolicySnapshot>('/policy'),
          api<readonly WorkThread[]>('/threads?limit=20'),
          api<SemanticSummaryState>('/semantic'),
          api<readonly TimelineDay[]>('/timeline?days=7'),
          api<RetentionSettings>('/retention'),
        ])
      setState(nextState)
      setEpisodes(nextEpisodes)
      setPolicy(nextPolicy)
      setThreads(nextThreads)
      setSemantic(nextSemantics)
      setTimeline(nextTimeline)
      setRetention(nextRetention)
      setRetentionHours(String(nextRetention.observationRetentionHours))
      setRetentionDays(String(nextRetention.episodeRetentionDays))
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

  const allowApp = async (explicit?: string): Promise<void> => {
    const value = (explicit ?? bundleId).trim()
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

  const forgetApp = async (explicit?: string): Promise<void> => {
    const value = (explicit ?? bundleId).trim()
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

  const findWhereILeftOff = async (): Promise<void> => {
    const result = await api<ResumeResolution>('/resume-hint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: resumeQuery,
        nowMs: Date.now(),
        turn: 1,
        source: 'tool',
      }),
    })
    setHint(result)
  }

  // First thing on the page: whether the product is working at all. An empty
  // timeline has four meanings and only this sentence distinguishes them.
  const health = describeHealth({
    capture: state?.capture ?? 'stopped',
    accessibilityTrusted: state?.accessibilityTrusted ?? false,
    allowRules: policy?.rules.filter(rule => rule.action === 'allow').length ?? 0,
    observationCount: episodes.length,
    newestObservationAtMs: episodes[0]?.startedAtMs,
    nowMs: Date.now(),
  })
  const healthSection = React.createElement(
    'section',
    { style: { margin: '0 0 16px' } },
    React.createElement(
      'p',
      {
        role: 'status',
        style: {
          margin: 0,
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid',
          borderColor: health.level === 'blocked' ? '#d97706' : '#3f6212',
          background: health.level === 'blocked' ? '#fffbeb' : '#f7fee7',
        },
      },
      health.text,
    ),
  )

  const resumeSection = React.createElement(
    'section',
    {
      style: {
        border: '1px solid #d0d0d0',
        borderRadius: 8,
        padding: 12,
        marginBottom: 20,
      },
    },
    React.createElement('h2', { style: { margin: '0 0 8px' } }, 'Resume'),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 8 } },
      React.createElement('input', {
        type: 'text',
        placeholder: 'e.g. continue the billing work',
        value: resumeQuery,
        onChange: (event: { target: { value: string } }) => {
          setResumeQuery(event.target.value)
        },
        style: { flex: 1, padding: 6 },
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: resumeQuery.trim().length === 0,
          onClick: () => { runAction(findWhereILeftOff) },
        },
        'Find where I left off',
      ),
    ),
    hint
      ? React.createElement(
          'p',
          { style: { marginTop: 10 } },
          hint.status === 'hit'
            ? `Resume “${hint.episode.workspace?.title ?? hint.episode.id}” — open ${hint.resource?.displayLabel ?? hint.resource?.canonicalUri ?? 'the last activity'} (${hint.citations.length} citations, confidence ${hint.confidence.toFixed(2)}, ${hint.reasons.join(', ')})`
            : hint.status === 'ambiguous'
              ? `More than one candidate: ${hint.reason}`
              : `Nothing to resume: ${hint.reason}`,
        )
      : null,
  )

  const revokeScope = async (scopeKey: string): Promise<void> => {
    await api('/semantic/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeKey }),
    })
    setPreview(undefined)
    await refresh()
  }

  const previewScope = async (scopeKey: string): Promise<void> => {
    const payload = await api<MinimisedSummaryPayload>(
      `/semantic/preview?scope=${encodeURIComponent(scopeKey)}`,
    )
    setPreview(`${scopeKey}\n${JSON.stringify(payload, null, 2)}`)
  }

  const semanticSection = React.createElement(
    'section',
    { style: { marginBottom: 20 } },
    React.createElement('h2', { style: { margin: '0 0 8px' } }, 'Summaries'),
    React.createElement(
      'p',
      null,
      semantic
        ? semantic.scopes.some(scope => scope.providerKind === 'remote')
          ? 'Deterministic summaries are on. At least one scope sends a minimised payload to a remote model: it contains the application id, the surface kind, the file extension, counts, an hour and the workspace folder name - never a path, a URL or a document name. **Once a request has left, it cannot be recalled**, and revoking the scope deletes only the local record of it.'
          : `Deterministic summaries are on (nothing leaves this machine). Local model: ${semantic.localProviderConfigured ? 'configured' : 'not configured'}; remote: never without a scope opting in.`
        : 'Loading…',
    ),
    !semantic || semantic.scopes.length === 0
      ? React.createElement(
          'p',
          { style: { color: '#555' } },
          'No scope uses a model, so every summary here was computed locally.',
        )
      : React.createElement(
          'ul',
          { style: { margin: 0, paddingLeft: 18 } },
          ...semantic.scopes.map(scope => React.createElement(
            'li',
            { key: scope.scopeKey, style: { marginBottom: 6 } },
            `${scope.scopeKey} — ${scope.providerKind}${scope.model ? ` (${scope.model})` : ''}`,
            ' ',
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => { runAction(() => previewScope(scope.scopeKey)) },
              },
              'Preview payload',
            ),
            ' ',
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => { runAction(() => revokeScope(scope.scopeKey)) },
              },
              'Turn off and purge',
            ),
          )),
        ),
    preview
      ? React.createElement(
          'pre',
          {
            style: {
              background: '#f2f2f2',
              padding: 8,
              borderRadius: 4,
              overflowX: 'auto',
            },
          },
          preview,
        )
      : null,
  )

  const saveRetention = async (): Promise<void> => {
    const next = await api<RetentionSettings>('/retention', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        observationRetentionHours: Number(retentionHours),
        episodeRetentionDays: Number(retentionDays),
      }),
    })
    setRetention(next)
  }

  const retentionSection = React.createElement(
    'section',
    { style: { marginBottom: 20 } },
    React.createElement('h2', { style: { margin: '0 0 8px' } }, 'Retention'),
    retention
      ? React.createElement(
          'div',
          null,
          React.createElement(
            'p',
            { style: { color: '#555', margin: '0 0 6px' } },
            'Raw observations are kept for '
              + retention.observationRetentionHours
              + ' hours and episodes for '
              + retention.episodeRetentionDays
              + ' days. A change applies to what is recorded from now on; it '
              + 'does not delete history you already have.',
          ),
          React.createElement(
            'label',
            null,
            'Observation hours ',
            React.createElement('input', {
              type: 'number',
              value: retentionHours,
              min: 1,
              max: 720,
              onChange: (event: { target: { value: string } }) => {
                setRetentionHours(event.target.value)
              },
            }),
          ),
          ' ',
          React.createElement(
            'label',
            null,
            'Episode days ',
            React.createElement('input', {
              type: 'number',
              value: retentionDays,
              min: 1,
              max: 365,
              onChange: (event: { target: { value: string } }) => {
                setRetentionDays(event.target.value)
              },
            }),
          ),
          ' ',
          React.createElement(
            'button',
            { type: 'button', onClick: () => { runAction(saveRetention) } },
            'Save retention',
          ),
        )
      : null,
  )

  const openEpisode = async (id: string): Promise<void> => {
    setSelected(await api<EpisodeDetail>(`/episode?id=${encodeURIComponent(id)}`))
  }

  const timelineSection = React.createElement(
    'section',
    { style: { marginBottom: 20 } },
    React.createElement('h2', { style: { margin: '0 0 8px' } }, 'Timeline'),
    timeline.length === 0
      ? React.createElement(
          'p',
          { style: { color: '#555' } },
          'Nothing recorded in the last seven days.',
        )
      : React.createElement(
          'div',
          null,
          ...timeline.map(day => React.createElement(
            'div',
            { key: day.dayKey, style: { marginBottom: 10 } },
            React.createElement(
              'div',
              { style: { fontWeight: 600 } },
              `${day.dayKey} · ${day.episodeCount} episode${day.episodeCount === 1 ? '' : 's'}`,
            ),
            React.createElement(
              'ul',
              { style: { margin: '4px 0 0', paddingLeft: 18 } },
              ...day.episodes.map(item => React.createElement(
                'li',
                { key: String(item.id) },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => { runAction(() => openEpisode(String(item.id))) },
                  },
                  item.summary,
                ),
              )),
            ),
          )),
        ),
    selected
      ? React.createElement(
          'div',
          {
            style: {
              border: '1px solid #d0d0d0',
              borderRadius: 8,
              padding: 12,
              marginTop: 8,
            },
          },
          React.createElement('h3', { style: { margin: '0 0 6px' } }, 'Why was this recorded?'),
          React.createElement('p', null, describeProvenance({
            boundary: selected.boundary,
            // The stored episode does not carry the revision that was in
              // force when it was written; the boundary reasons and citations
              // are what the reader can check.
            policyRevision: 0,
            citations: selected.summaryObservationIds,
            resources: selected.resources,
            surfaces: selected.surfaces,
            confidence: selected.confidence,
          })),
          React.createElement(
            'p',
            { style: { color: '#555' } },
            selected.resources.length > 0
              ? 'Resources: ' + selected.resources
                .map(item => item.displayLabel ?? item.canonicalUri)
                .join(', ')
              // "Unanchored" is a fact about the workspace, not about the
              // episode: it still knows which applications were involved, and
              // saying so is more useful than a shrug.
              : 'No resource was visible. This episode is unanchored, but the '
                + 'applications it saw were: '
                + selected.surfaces
                  .map(item => item.bundleId)
                  .join(', '),
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            ...selected.surfaces.map(surface => React.createElement(
              'span',
              { key: surface.bundleId },
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    runAction(async () => {
                      setBundleId(surface.bundleId)
                      // One click from the episode: allow this application
                      // without typing its bundle id anywhere.
                      await allowApp(surface.bundleId)
                    })
                  },
                },
                `Allow ${surface.bundleId}`,
              ),
              ' ',
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    runAction(async () => {
                      setBundleId(surface.bundleId)
                      await forgetApp(surface.bundleId)
                    })
                  },
                },
                `Forget ${surface.bundleId}`,
              ),
            )),
          ),
        )
      : null,
  )

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
          ? `Listening on 127.0.0.1:${companion.port} · ${companion.paired ? (companion.lastSeenAtMs === undefined ? 'token created, but no client has ever used it' : `paired · last used ${new Date(companion.lastSeenAtMs).toLocaleString()}`) : 'not paired yet'}`
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
          'div',
          null,
          React.createElement(
            'p',
            { style: { color: '#555' } },
            'Only a digest is stored, so this is the one moment it can be copied. Rotating it again stops any client still using the old one.',
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                void navigator.clipboard?.writeText(companionToken).then(
                  () => { setCopiedToken(true) },
                  () => { setCopiedToken(false) },
                )
              },
            },
            copiedToken ? 'Copied' : 'Copy token',
          ),
          React.createElement(
            'ol',
            { style: { color: '#555', marginTop: 8, paddingLeft: 20 } },
            React.createElement(
              'li',
              null,
              'Browser: open the extension’s options page and paste it there.',
            ),
            React.createElement(
              'li',
              null,
              'VS Code or Cursor: in Settings search for ',
              React.createElement('code', null, 'computer history'),
              ', then set the token (and the port ',
              React.createElement('code', null, String(companion?.port ?? 19388)),
              ').',
            ),
            React.createElement(
              'li',
              null,
              'Then reload that client. If nothing arrives, its own log says why: the editor extension writes one to ',
              React.createElement('code', null, '~/.dsh/computer-history-editor.log'),
              '.',
            ),
          ),
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
    retentionSection,
    timelineSection,
    semanticSection,
    healthSection,
    resumeSection,
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
