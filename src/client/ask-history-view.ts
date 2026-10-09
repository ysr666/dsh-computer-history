import React from 'react'
import type { AskHistoryResult, HistorySearchHit } from '../shared/index.js'
import { historyApi } from './api.js'

interface Props {
  readonly locale: string
  readonly historyRevision: number
}

function translatedKind(kind: HistorySearchHit['kind'], zh: boolean): string {
  const cn: Record<HistorySearchHit['kind'], string> = {
    workspace: '项目', file: '文件', application: '应用',
    save: '保存记录', verification: '历史测试',
  }
  return zh ? cn[kind] : kind
}

/** A local metadata index, not an AI-composed answer. */
export function AskHistoryView({ locale, historyRevision }: Props): React.ReactElement {
  const zh = locale.toLowerCase().startsWith('zh')
  const t = (cn: string, en: string): string => zh ? cn : en
  const [question, setQuestion] = React.useState('')
  const [answer, setAnswer] = React.useState<AskHistoryResult>()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [expanded, setExpanded] = React.useState(false)
  const [source, setSource] = React.useState<{
    id: string; summary: string; startedAtMs: number; endedAtMs: number
  }>()
  const requestId = React.useRef(0)

  React.useEffect(() => {
    requestId.current += 1
    setAnswer(undefined)
    setSource(undefined)
    setLoading(false)
    setError('')
  }, [historyRevision])

  const ask = async (): Promise<void> => {
    if (loading || !question.trim()) return
    const current = ++requestId.current
    setLoading(true)
    setAnswer(undefined)
    setSource(undefined)
    setError('')
    try {
      const result = await historyApi.askHistory({ query: question.trim(), limit: 12 })
      if (requestId.current === current) setAnswer(result)
    } catch {
      if (requestId.current === current) {
        setError(t('查询失败，请调整问题后重试。', 'Search failed. Try rewording your question.'))
      }
    } finally {
      if (requestId.current === current) setLoading(false)
    }
  }

  const openSource = async (hit: HistorySearchHit): Promise<void> => {
    const current = ++requestId.current
    setSource(undefined)
    setError('')
    try {
      const episode = await historyApi.getEpisode(hit.episodeId)
      if (requestId.current === current) {
        setSource({
          id: String(episode.id),
          summary: episode.summary,
          startedAtMs: episode.startedAtMs,
          endedAtMs: episode.endedAtMs,
        })
      }
    } catch {
      if (requestId.current === current) {
        setError(t('来源已被删除或过期。', 'The source is no longer available.'))
      }
    }
  }

  return React.createElement('section', { className: 'ch-ask-panel' },
    React.createElement('button', {
      type: 'button',
      className: 'ch-text-action ch-ask-toggle',
      'aria-expanded': expanded,
      onClick: () => {
        requestId.current += 1
        setExpanded(value => !value)
        setSource(undefined)
        setLoading(false)
      },
    }, t('问问工作历史', 'Ask Your History'), '  ', expanded ? '⌄' : '›'),
    React.createElement('p', { className: 'ch-muted' },
      t('用自然语言检索已记录的项目、文件和应用活动。无需联网，也不会读取文件正文。',
        'Search recorded projects, files and app activity in natural language—locally, without file contents.')),
    expanded ? React.createElement('div', { className: 'ch-ask-body' },
      React.createElement('form', {
        className: 'ch-ask-form',
        onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void ask()
        },
      },
      React.createElement('input', {
        type: 'search', maxLength: 300,
        className: 'ch-input ch-ask-input',
        value: question,
        'aria-label': t('提问工作历史', 'Ask your history'),
        placeholder: t('例如：上周修改过哪些文件？', 'e.g. Which files did I edit last week?'),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          requestId.current += 1
          setQuestion(event.target.value)
          setAnswer(undefined)
          setSource(undefined)
          setLoading(false)
        },
      }),
      React.createElement('button', {
        type: 'submit', className: 'ch-button ch-continue-primary',
        disabled: loading || !question.trim(),
      }, loading ? t('检索中…', 'Searching…') : t('查找记录', 'Find history')),
      ),
      error ? React.createElement('p', { role: 'alert' }, error) : null,
      answer ? React.createElement(React.Fragment, null,
        React.createElement('p', { className: 'ch-muted', role: 'status' },
          answer.items.length
            ? t('找到 ' + answer.items.length + ' 条历史线索。',
                'Found ' + answer.items.length + ' historical leads.')
            : t('在目前保留的记录里未找到匹配线索。',
                'No matching evidence in retained history.'),
          answer.scanTruncated
            ? ' ' + t('结果可能不完整。', 'Search may be incomplete.') : ''),
        React.createElement('p', { className: 'ch-muted' },
          t('仅来自历史元数据；不是当前任务的完成证明。长期笔记未参与查询。',
            'Historical metadata only, not current proof. Long-term notes were not searched.')),
        React.createElement('ul', { className: 'ch-ask-results' },
          ...answer.items.map(hit => React.createElement('li', {
            key: hit.id, className: 'ch-ask-hit',
          },
          React.createElement('div', { className: 'ch-ask-hit-top' },
            React.createElement('span', { className: 'ch-ask-kind' },
              translatedKind(hit.kind, zh)),
            React.createElement('strong', null, hit.title),
          ),
          React.createElement('p', { className: 'ch-muted' },
            (hit.workspaceTitle ? hit.workspaceTitle + ' · ' : '')
            + new Date(hit.observedAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US')),
          React.createElement('p', { className: 'ch-muted' },
            hit.evidenceLevel === 'episode-compacted'
              ? t('原始观测已过期 · Episode 证据', 'Compacted Episode evidence')
              : t('历史观测可追溯', 'Observation-backed evidence')),
          React.createElement('button', {
            type: 'button', className: 'ch-text-action',
            onClick: () => { void openSource(hit) },
          }, t('查看来源 Episode', 'Inspect source Episode')),
          ))),
        source ? React.createElement('div', { className: 'ch-ask-source' },
          React.createElement('strong', null, t('来源工作片段', 'Source Episode')),
          React.createElement('p', { className: 'ch-muted' }, source.id),
          React.createElement('p', null, source.summary),
        ) : null,
      ) : null,
    ) : null,
  )
}
