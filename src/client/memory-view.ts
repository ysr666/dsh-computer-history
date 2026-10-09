import React from 'react'
import type { MemoryFact, ProjectMemory } from '../shared/index.js'
import { historyApi } from './api.js'

interface WorkMemoryViewProps {
  readonly locale: string
  readonly historyRevision: number
}

function translatedFact(fact: MemoryFact, zh: boolean): string {
  if (!zh) return fact.text
  const value = fact.text
  if (fact.kind === 'workspace') return '工作区：' + value.replace(/^Workspace: /, '')
  if (fact.kind === 'resource') return '最近使用：' + value.replace(/^Recently used: /, '')
  if (fact.kind === 'save') return '观察到保存：' + value.replace(/^Observed save: /, '')
  if (fact.kind === 'activity') return '观察到应用活动：' + value.replace(/^Observed app: /, '')
  const match = /^Historically observed (build|test|other) (success|failure)/.exec(value)
  if (match) {
    const task = match[1] === 'test' ? '测试' : match[1] === 'build' ? '构建' : '验证'
    return '历史' + task + '曾报告' + (match[2] === 'success' ? '成功' : '失败')
      + '；当前状态需要重新确认'
  }
  return value
}

/** Secondary, lazy-loaded reader under Work Threads. No persistent cache. */
export function WorkMemoryView({ locale, historyRevision }: WorkMemoryViewProps): React.ReactElement {
  const zh = locale.toLowerCase().startsWith('zh')
  const [expanded, setExpanded] = React.useState(false)
  const [projects, setProjects] = React.useState<readonly ProjectMemory[] | null>()
  const [selected, setSelected] = React.useState<ProjectMemory>()
  const [error, setError] = React.useState(false)
  const requestRevision = React.useRef(0)

  React.useEffect(() => {
    const current = ++requestRevision.current
    if (!expanded) {
      setSelected(undefined)
      return
    }
    setProjects(undefined)
    setSelected(undefined)
    setError(false)
    void historyApi.getProjectMemories(20).then(values => {
      if (requestRevision.current === current) setProjects(values)
    }).catch(() => {
      if (requestRevision.current === current) {
        setProjects(null)
        setError(true)
      }
    })
    return () => { requestRevision.current += 1 }
  }, [expanded, historyRevision])

  const openProject = (id: string): void => {
    const current = ++requestRevision.current
    setError(false)
    setSelected(undefined)
    void historyApi.getProjectMemory(id)
      .then(project => {
        if (requestRevision.current === current) setSelected(project)
      })
      .catch(() => {
        if (requestRevision.current === current) setError(true)
      })
  }

  return React.createElement(
    'div', { className: 'ch-project-history' },
    React.createElement('button', {
      type: 'button',
      className: 'ch-text-action',
      'aria-expanded': expanded,
      onClick: () => setExpanded(value => !value),
    }, zh ? '工作记忆 · 查看项目概览' : 'Work memory · View project context'),
    expanded ? React.createElement(
      'div', { className: 'ch-project-days' },
      React.createElement('p', { className: 'ch-muted' },
        zh
          ? '仅依据允许记录的应用、资源与工作片段整理。历史状态不代表当前任务已完成。'
          : 'Derived from allowed app/resource metadata and stored work episodes. Historical state is not proof of completion.'),
      projects === undefined
        ? React.createElement('p', { role: 'status', className: 'ch-muted' }, zh ? '读取工作记忆中…' : 'Loading work memory…')
        : projects === null
          ? React.createElement('p', { role: 'alert', className: 'ch-muted' }, zh ? '暂时无法读取工作记忆。' : 'Work memory unavailable.')
          : projects.length === 0
            ? React.createElement('p', { className: 'ch-muted' }, zh ? '暂无可归属项目的工作记忆。' : 'No project-backed work memory yet.')
            : React.createElement('ul', { className: 'ch-project-activity-list' },
                ...projects.map(project => React.createElement('li', { key: project.id },
                  React.createElement('button', {
                    type: 'button',
                    className: 'ch-text-action',
                    'aria-expanded': selected?.id === project.id,
                    onClick: () => openProject(project.id),
                  }, project.title),
                  React.createElement('span', { className: 'ch-muted' },
                    zh ? ' · ' + project.episodeCount + ' 个历史片段' : ' · ' + project.episodeCount + ' episodes'),
                )),
              ),
      selected
        ? React.createElement('section', { className: 'ch-inspector' },
            React.createElement('h3', null, selected.title),
            React.createElement('p', { className: 'ch-muted' },
              zh ? '只读、按需生成；来源删除或过期后会重新计算。'
                : 'Read-only, generated on demand; deletion and expiry remove derived facts.'),
            React.createElement('ul', { className: 'ch-project-activity-list' },
              ...selected.facts.map(fact => React.createElement('li', { key: fact.id },
                React.createElement('span', null, translatedFact(fact, zh)),
                React.createElement('span', { className: 'ch-muted' },
                  fact.evidenceLevel === 'episode-compacted'
                    ? (zh ? ' · 原始证据已按保留期清理' : ' · Raw observations expired')
                    : (zh ? ' · 原始记录可追溯' : ' · Observation-backed')),
              )),
            ),
          )
        : null,
      error ? React.createElement('p', { role: 'alert', className: 'ch-muted' },
        zh ? '工作记忆读取失败，请重试。' : 'Could not load project memory. Retry.') : null,
    ) : null,
  )
}
