import React from 'react'
import type {
  AskHistoryResult, EpisodeDetail, EpisodeSummary, HistorySearchHit,
} from '../shared/index.js'
import { historyApi } from './api.js'

interface Props {
  readonly locale: string
  readonly historyRevision: number
  /** Opens a normal editable DSH composer; does not automatically send. */
  readonly onAskWithAi?: (question: string) => Promise<void>
  readonly onContinue?: (episode: EpisodeSummary) => Promise<void>
}

function translatedKind(kind: HistorySearchHit['kind'], zh: boolean): string {
  const cn: Record<HistorySearchHit['kind'], string> = {
    workspace: '项目', file: '文件', application: '应用',
    save: '保存记录', verification: '历史测试',
  }
  return zh ? cn[kind] : kind
}

/**
 * Never re-resolve an ambiguous phrase when the user selected an exact hit.
 * Read the original Episode before invoking the existing Continue flow.
 * The Host's Continue binding performs the authoritative retention check.
 */
async function readExactHistoryEpisode(
  episodeId: string,
  getEpisode: (id: string) => Promise<EpisodeDetail>,
): Promise<EpisodeDetail> {
  const exactId = episodeId.trim()
  if (!exactId || exactId.length > 1_000) throw new Error('Invalid Episode ID')
  const episode = await getEpisode(exactId)
  if (!episode || String(episode.id) !== exactId || episode.state === 'invalidated') {
    throw new Error('Selected history episode is unavailable')
  }
  return episode
}

export async function continueExactHistoryEpisode(
  episodeId: string,
  getEpisode: (id: string) => Promise<EpisodeDetail>,
  continueEpisode: (episode: EpisodeSummary) => Promise<void>,
): Promise<void> {
  // Re-fetch the exact retained source before passing it to the existing
  // Continue path; the Host itself re-checks TTL on binding.
  await continueEpisode(await readExactHistoryEpisode(episodeId, getEpisode))
}

export async function continueFromHistoryHit(
  hit: HistorySearchHit,
  getEpisode: (id: string) => Promise<EpisodeDetail>,
  continueEpisode: (episode: EpisodeSummary) => Promise<void>,
): Promise<void> {
  return continueExactHistoryEpisode(hit.episodeId, getEpisode, continueEpisode)
}

/** A local metadata index, not an AI-composed answer. */
export function AskHistoryView({ locale, historyRevision, onAskWithAi, onContinue }: Props): React.ReactElement {
  const zh = locale.toLowerCase().startsWith('zh')
  const t = (cn: string, en: string): string => zh ? cn : en
  const [question, setQuestion] = React.useState('')
  const [answer, setAnswer] = React.useState<AskHistoryResult>()
  const [loading, setLoading] = React.useState(false)
  const [aiPending, setAiPending] = React.useState(false)
  const [continuePendingId, setContinuePendingId] = React.useState<string>()
  const [exactInput, setExactInput] = React.useState('')
  const [exactEpisode, setExactEpisode] = React.useState<EpisodeDetail>()
  const [exactPending, setExactPending] = React.useState(false)
  const [error, setError] = React.useState('')
  const [expanded, setExpanded] = React.useState(false)
  const [source, setSource] = React.useState<{
    hitId: string; id: string; summary: string; startedAtMs: number; endedAtMs: number
  }>()
  const requestId = React.useRef(0)
  const exactRequestId = React.useRef(0)
  const continueInFlight = React.useRef(false)

  React.useEffect(() => {
    requestId.current += 1
    setAnswer(undefined)
    setSource(undefined)
    exactRequestId.current += 1
    setExactEpisode(undefined)
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

  const askAi = async (): Promise<void> => {
    if (!onAskWithAi || !question.trim() || aiPending) return
    setError('')
    setAiPending(true)
    try {
      await onAskWithAi(question.trim())
    } catch {
      setError(t('无法打开 DSH AI 对话，请检查会话功能。',
        'Could not open a DSH AI conversation. Check session availability.'))
    } finally {
      setAiPending(false)
    }
  }

  const continueHit = async (hit: HistorySearchHit): Promise<void> => {
    if (!onContinue || continueInFlight.current) return
    // A ref is synchronous even before React commits the disabled state.
    // It prevents double-clicks from creating two DSH Continue sessions.
    continueInFlight.current = true
    setContinuePendingId(hit.id)
    setError('')
    try {
      await continueFromHistoryHit(hit, historyApi.getEpisode, onContinue)
    } catch {
      setError(t('无法继续这条工作记录：它可能已经过期或不可用。',
        'Cannot continue this work: its source may have expired or become unavailable.'))
    } finally {
      continueInFlight.current = false
      setContinuePendingId(undefined)
    }
  }

  const inspectExact = async (): Promise<void> => {
    const id = exactInput.trim()
    if (!id || id.length > 1_000 || exactPending) return
    const request = ++exactRequestId.current
    setExactPending(true)
    setExactEpisode(undefined)
    setError('')
    try {
      const episode = await readExactHistoryEpisode(id, historyApi.getEpisode)
      if (request !== exactRequestId.current) return
      setExactEpisode(episode)
    } catch {
      if (request === exactRequestId.current) {
        setError(t('未找到有效的 Episode，请核对 AI 回答中的来源 ID。',
          'No retained Episode matches this exact ID. Check the AI answer.'))
      }
    } finally {
      if (request === exactRequestId.current) setExactPending(false)
    }
  }

  const continueExact = async (): Promise<void> => {
    if (!onContinue || !exactEpisode || continueInFlight.current) return
    continueInFlight.current = true
    const id = String(exactEpisode.id)
    setContinuePendingId('exact:' + id)
    setError('')
    try {
      await continueExactHistoryEpisode(id, historyApi.getEpisode, onContinue)
    } catch {
      setExactEpisode(undefined)
      setError(t('无法继续这个 Episode：来源可能已经过期或不可用。',
        'This Episode cannot be continued; the source may have expired.'))
    } finally {
      continueInFlight.current = false
      setContinuePendingId(undefined)
    }
  }

  const openSource = async (hit: HistorySearchHit): Promise<void> => {
    const current = ++requestId.current
    setSource(undefined)
    setError('')
    try {
      const episode = await readExactHistoryEpisode(hit.episodeId, historyApi.getEpisode)
      if (requestId.current === current) {
        setSource({
          hitId: hit.id,
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
        exactRequestId.current += 1
        setExactEpisode(undefined)
        setLoading(false)
      },
    }, t('查询工作历史', 'Explore Work History'), '  ', expanded ? '⌄' : '›'),
    React.createElement('p', { className: 'ch-muted' },
      t('复杂问题可交给 DSH AI 组合检索；本地查找不调用模型，也不会读取文件正文。',
        'Ask the DSH AI to combine evidence for complex questions, or search locally without a model. No file bodies are read.')),
    expanded ? React.createElement('div', { className: 'ch-ask-body' },
      React.createElement('form', {
        className: 'ch-ask-form',
        onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          if (onAskWithAi) void askAi()
          else void ask()
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
      onAskWithAi ? React.createElement('button', {
        type: 'submit', className: 'ch-button ch-continue-primary',
        disabled: aiPending || !question.trim(),
      }, aiPending ? t('正在打开…', 'Opening…') : t('在 DSH 中询问 AI', 'Ask DSH AI')) : null,
      React.createElement('button', {
        type: onAskWithAi ? 'button' : 'submit',
        className: 'ch-button',
        disabled: loading || !question.trim(),
        onClick: onAskWithAi ? () => { void ask() } : undefined,
      }, loading ? t('检索中…', 'Searching…') : t('本地快速查找', 'Quick local search')),
      ),
      onAskWithAi
        ? React.createElement('p', { className: 'ch-muted' },
            t('AI 查询会使用当前 DSH 模型。历史元数据可能进入所配置的远程模型；本地快速查找不会。问题会先进入可编辑的输入框，不会自动发送。',
              'AI questions use your configured DSH model; work metadata may reach a remote provider. Quick local search does not. The question opens as an editable draft and is never sent automatically.'))
        : null,
      onAskWithAi && onContinue ? React.createElement('div', {
        className: 'ch-ask-exact',
      },
      React.createElement('p', { className: 'ch-muted' },
        t('AI 回答含有来源 Episode ID？粘贴 ID、核对历史来源，再手动继续。不会自动打开工作。',
          'Have a source Episode ID from AI? Paste it, inspect the historical source, then explicitly continue. Nothing opens automatically.')),
      React.createElement('form', {
        className: 'ch-ask-form',
        onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void inspectExact()
        },
      },
      React.createElement('input', {
        type: 'text', maxLength: 1_000,
        className: 'ch-input ch-ask-input',
        value: exactInput,
        'aria-label': t('来源 Episode ID', 'Source Episode ID'),
        placeholder: t('粘贴准确的 Episode ID', 'Paste exact Episode ID'),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          exactRequestId.current += 1
          setExactInput(event.target.value)
          setExactEpisode(undefined)
          setExactPending(false)
          setError('')
        },
      }),
      React.createElement('button', {
        type: 'submit', className: 'ch-button',
        disabled: !exactInput.trim() || exactPending,
      }, exactPending ? t('核对中…', 'Inspecting…') : t('核对 Episode 来源', 'Inspect Episode source')),
      ),
      exactEpisode ? React.createElement('div', {
        className: 'ch-ask-source ch-ask-exact-preview',
        role: 'region',
        'aria-label': t('待确认的历史来源', 'Historical source awaiting confirmation'),
      },
      React.createElement('strong', null,
        t('核对历史工作片段', 'Review historical work')),
      React.createElement('p', { className: 'ch-ask-source-id' }, String(exactEpisode.id)),
      React.createElement('p', { className: 'ch-ask-source-meta' },
        (exactEpisode.workspace?.title || t('未关联项目', 'No recorded workspace'))
        + ' · ' + new Date(exactEpisode.endedAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US')),
      React.createElement('p', { className: 'ch-ask-source-summary' }, exactEpisode.summary),
      exactEpisode.resources.length > 0
        ? React.createElement('ul', { className: 'ch-ask-source-resources' },
            ...exactEpisode.resources.slice(0, 3).map(resource =>
              React.createElement('li', { key: resource.kind + ':' + resource.canonicalUri },
                resource.displayLabel || resource.canonicalUri)),
          )
        : null,
      React.createElement('p', { className: 'ch-ask-source-caution' },
        t('这是留存的历史线索，不代表文件现在存在或任务已经完成。继续之前请核对当前工作状态。',
          'This is retained historical evidence, not proof the file still exists or the task is complete. Verify current work after continuing.')),
      React.createElement('button', {
        type: 'button', className: 'ch-button ch-continue-primary',
        disabled: continuePendingId !== undefined,
        onClick: () => { void continueExact() },
      }, continuePendingId === 'exact:' + String(exactEpisode.id)
        ? t('正在继续…', 'Continuing…')
        : t('继续此 Episode', 'Continue this Episode')),
      ) : null,
      ) : null,
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
            'aria-label': t('查看来源：' + hit.title, 'Inspect source: ' + hit.title),
            onClick: () => { void openSource(hit) },
          }, t('查看来源 Episode', 'Inspect source Episode')),
          onContinue ? React.createElement('button', {
            type: 'button',
            className: 'ch-button ch-continue-primary',
            'aria-label': t('继续工作：' + hit.title, 'Continue work: ' + hit.title),
            disabled: continuePendingId !== undefined,
            onClick: () => { void continueHit(hit) },
          }, continuePendingId === hit.id
            ? t('正在继续…', 'Continuing…')
            : t('继续此项工作', 'Continue this work')) : null,
          source?.hitId === hit.id ? React.createElement('div', {
            className: 'ch-ask-source',
            role: 'region',
            'aria-label': t('当前结果的来源', 'Source for selected result'),
          },
            React.createElement('strong', null, t('来源工作片段', 'Source Episode')),
            React.createElement('p', { className: 'ch-muted' }, source.id),
            React.createElement('p', null, source.summary),
          ) : null,
          ))),
      ) : null,
    ) : null,
  )
}
