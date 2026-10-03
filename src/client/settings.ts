// The settings page, registered the way this application expects a plugin to register one.
//
// Learned from the plugin that does this well: it registers into `settings.section`, so the application
// provides the frame, the heading, the spacing and the list, and the plugin supplies rows. The first version of
// this plugin owned the whole main panel and drew every control itself, which is why it looked foreign.
//
// The rows follow the reference implementation of the same feature (ChatGPT/Codex "Computer History"): what is
// being recorded and how to pause it, which applications and sites take part, retention, deleting history, the
// browser companion, and a diagnostic line. Each row is one decision, in the order the reference uses.
import type { Context } from '@deepseek-ai/cordis'
import React from 'react'
import type { ComputerHistoryState, PolicySnapshot, RetentionSettings } from '../shared/index.js'
import { historyApiPath } from './api-route.js'

type Translate = (en: string, zh: string) => string

const ROW: React.CSSProperties = { padding: '14px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' }
const TITLE: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600 }
const BODY: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--dsw-alias-label-secondary)',
}
const CONTROLS: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }
// Measured from the application's own controls: 14px, 36px tall, radius 12, no border, translucent fill.
const BUTTON: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  height: 36,
  padding: '0 14px',
  borderRadius: 12,
  border: 'none',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'inherit',
  cursor: 'pointer',
}
const BUTTON_PRIMARY: React.CSSProperties = {
  ...BUTTON,
  background: 'var(--dsw-alias-brand-primary)',
  color: '#fff',
  fontWeight: 600,
}
const BUTTON_DANGER: React.CSSProperties = { ...BUTTON, background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', border: '1px solid var(--dsw-alias-border-l1)' }
const FIELD: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  height: 36,
  width: 92,
  padding: '0 10px',
  borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'inherit',
}
const CODE: React.CSSProperties = {
  margin: '8px 0 0',
  padding: '10px 12px',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-2)',
  fontSize: 12,
  overflowX: 'auto',
}

interface SettingsProps {
  readonly t: Translate
}

function useJson<T>(path: string, initial: T): [T, () => Promise<void>] {
  const [value, setValue] = React.useState<T>(initial)
  const load = React.useCallback(async () => {
    try {
      const response = await fetch(path, { credentials: 'same-origin' })
      if (!response.ok) return
      setValue((await response.json()) as T)
    } catch {
      // A settings page that cannot reach the Host says so through the values it already has.
    }
  }, [path])
  React.useEffect(() => { void load() }, [load])
  return [value, load]
}

const row = (...children: React.ReactNode[]): React.ReactElement =>
  React.createElement('li', { style: ROW }, ...children)

const url = (path: string): string => historyApiPath(path)

export function createSettingsPage({ t }: SettingsProps): () => React.ReactElement {
  return function SettingsPage(): React.ReactElement {
    const [state, reloadState] = useJson<ComputerHistoryState | undefined>(url(historyApiPath('/state')), undefined)
    const [policy] = useJson<PolicySnapshot | undefined>(url(historyApiPath('/policy')), undefined)
    const [retention, reloadRetention] = useJson<RetentionSettings | undefined>(url(historyApiPath('/retention')), undefined)
    const [observationHours, setObservationHours] = React.useState('')
    const [episodeDays, setEpisodeDays] = React.useState('')
    const [confirming, setConfirming] = React.useState(false)
    const [note, setNote] = React.useState<string | undefined>(undefined)

    React.useEffect(() => {
      if (retention && observationHours === '') setObservationHours(String(retention.observationRetentionHours))
      if (retention && episodeDays === '') setEpisodeDays(String(retention.episodeRetentionDays))
    }, [retention, observationHours, episodeDays])

    const post = React.useCallback(async (path: string, body: unknown): Promise<boolean> => {
      try {
        const response = await fetch(url(historyApiPath(path)), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        return response.ok
      } catch {
        return false
      }
    }, [url])

    const recording = state?.capture === 'running'
    const userRules = (policy?.rules ?? []).filter(rule => !rule.builtIn)
    const allowed = userRules.filter(rule => rule.action === 'allow')
    const denied = userRules.filter(rule => rule.action !== 'allow')
    const companion = state?.companion

    return React.createElement(
      'ul',
      { style: { listStyle: 'none', margin: 0, padding: 0 } },

      row(
        React.createElement('p', { style: TITLE }, t('Recording', '记录')),
        React.createElement('p', { style: BODY },
          recording
            ? t('This machine is being recorded. Only what you allow, and only metadata.', '正在记录这台电脑的活动。只记你允许的，而且只记元数据。')
            : t('Not recording right now. Nothing new is being written.', '当前没有在记录。新的内容不会被写入。')),
        React.createElement('div', { style: CONTROLS },
          // Pause exists in the Host service but its route is not confirmed from here, so this page shows the
          // state and offers the controls whose routes the panel already uses. A button that might 404 is worse
          // than no button.
          React.createElement('button', { style: BUTTON, onClick: () => { void reloadState() } },
            t('Refresh', '刷新'))),
        state?.reason
          ? React.createElement('p', { style: BODY }, `${t('Why', '原因')}：${state.reason}`)
          : null),

      row(
        React.createElement('p', { style: TITLE }, t('Applications and sites that take part', '参与的应用与网站')),
        React.createElement('p', { style: BODY },
          t(
            `Allowed: ${allowed.length}. Denied: ${denied.length}. Password managers stay protected whatever this says.`,
            `已允许 ${allowed.length} 项，已拒绝 ${denied.length} 项。密码管理器无论这里怎么设置都受保护。`,
          )),
        allowed.length > 0
          ? React.createElement('p', { style: BODY }, allowed.map(rule => rule.pattern).join(' · '))
          : React.createElement('p', { style: BODY }, t('Nothing is allowed yet, so nothing is recorded.', '还没有允许任何应用，所以什么都不会被记录。'))),

      row(
        React.createElement('p', { style: TITLE }, t('How long history is kept', '历史保留多久')),
        React.createElement('p', { style: BODY },
          t(
            'Raw observations and the episodes built from them. A change applies from now on; it does not delete what you already have.',
            '原始观测，以及由它构建出的片段。修改只影响之后记录的内容，不会删除你已经有的历史。',
          )),
        React.createElement('div', { style: CONTROLS },
          React.createElement('span', { style: BODY }, t('Observations (hours)', '原始记录（小时）')),
          React.createElement('input', {
            style: FIELD,
            value: observationHours,
            inputMode: 'numeric',
            onChange: event => { setObservationHours((event.target as HTMLInputElement).value) },
          }),
          React.createElement('span', { style: BODY }, t('Episodes (days)', '片段（天）')),
          React.createElement('input', {
            style: FIELD,
            value: episodeDays,
            inputMode: 'numeric',
            onChange: event => { setEpisodeDays((event.target as HTMLInputElement).value) },
          }),
          React.createElement('button', {
            style: BUTTON_PRIMARY,
            onClick: async () => {
              const ok = await post('retention', {
                observationRetentionHours: Number(observationHours),
                episodeRetentionDays: Number(episodeDays),
              })
              setNote(ok ? t('Saved.', '已保存。') : t('Could not save.', '保存失败。'))
              await reloadRetention()
            },
          }, t('Save', '保存'))),
        note ? React.createElement('p', { style: BODY }, note) : null),

      row(
        React.createElement('p', { style: TITLE }, t('Delete history', '删除历史')),
        React.createElement('p', { style: BODY },
          t(
            'Deleting removes the observations and episodes it covers. This cannot be undone, and it is the one action here that destroys data.',
            '删除会移除它覆盖范围内的观测与片段。此操作不可撤销，也是这一页上唯一会销毁数据的动作。',
          )),
        React.createElement('div', { style: CONTROLS },
          confirming
            ? React.createElement(React.Fragment, null,
                React.createElement('button', {
                  style: BUTTON_DANGER,
                  onClick: async () => {
                    const ok = await post('delete', { all: true })
                    setNote(ok ? t('History deleted.', '历史已删除。') : t('Could not delete.', '删除失败。'))
                    setConfirming(false)
                  },
                }, t('Yes, delete everything', '确认：删除全部')),
                React.createElement('button', { style: BUTTON, onClick: () => { setConfirming(false) } }, t('Cancel', '取消')))
            : React.createElement('button', { style: BUTTON_DANGER, onClick: () => { setConfirming(true) } },
                t('Delete all history…', '删除全部历史…')))),

      row(
        React.createElement('p', { style: TITLE }, t('Browser companion', '浏览器伴侣')),
        React.createElement('p', { style: BODY },
          companion?.listening
            ? t(`Listening on 127.0.0.1:${companion.port}, ${companion.paired ? 'paired' : 'not paired yet'}.`,
                `正在监听 127.0.0.1:${companion.port}，${companion.paired ? '已配对' : '还没有配对'}。`)
            : t('The companion listener is unavailable on this Host.', '这台宿主上伴侣接收端不可用。')),
        React.createElement('p', { style: BODY },
          t(
            'Pages are recorded only through the paired extension: Accessibility cannot tell a private window from an ordinary one.',
            '页面只通过已配对的扩展记录：辅助功能分不清隐私窗口和普通窗口。',
          )),
        React.createElement('div', { style: CONTROLS },
          React.createElement('button', {
            style: BUTTON_PRIMARY,
            onClick: async () => {
              const response = await fetch(url(historyApiPath('/companion/pair')), { method: 'POST', credentials: 'same-origin' })
              if (response.ok) {
                const body = (await response.json()) as { token?: string }
                setNote(body.token ? `${t('Pairing token', '配对令牌')}：${body.token}` : undefined)
              }
              await reloadState()
            },
          }, t('Create pairing token', '生成配对令牌'))),
        note ? React.createElement('pre', { style: CODE }, note) : null),

      row(
        React.createElement('p', { style: TITLE }, t('About', '关于')),
        React.createElement('p', { style: BODY },
          t(
            `Capture: ${state?.capture ?? 'unknown'} · Accessibility: ${state?.accessibilityTrusted ? 'granted' : 'not granted'} · collector ${state?.collector?.version ?? '—'}`,
            `采集：${state?.capture ?? '未知'} · 辅助功能：${state?.accessibilityTrusted ? '已授权' : '未授权'} · 采集器 ${state?.collector?.version ?? '—'}`,
          )),
        React.createElement('p', { style: BODY },
          t(
            'It never records screen contents, document text, selections, or what you type. Everything stays on this machine.',
            '它绝不记录屏幕内容、文档内容、选中文字或你输入的内容。一切都留在这台机器上。',
          ))),
    )
  }
}

/** Registers the section the way this application expects: the frame comes from the application. */
export function applySettings(ctx: Context, options: SettingsProps): void {
  const SettingsPage = createSettingsPage(options)
  ctx.effect(
    () => ctx.slots.inject('settings.section', function* () {
      yield ctx.slots.register(
        {
          name: 'settings.section',
          id: 'computer-history',
          order: 40,
          label: () => options.t('Computer History', '电脑使用记录'),
        },
        SettingsPage as never,
      )
    }),
    'computer-history: settings section',
  )
}
