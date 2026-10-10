import React from 'react'
import type { SkillCandidate, SkillCandidateReport } from '../shared/index.js'
import { historyApi } from './api.js'

interface Props {
  readonly projectId: string
  readonly locale: string
}

export function SkillCandidatesView({ projectId, locale }: Props): React.ReactElement {
  const zh = locale.toLowerCase().startsWith('zh')
  const t = (cn: string, en: string): string => zh ? cn : en
  const [report, setReport] = React.useState<SkillCandidateReport | null>()
  const [openEvidence, setOpenEvidence] = React.useState<string>()

  React.useEffect(() => {
    let valid = true
    setReport(undefined)
    setOpenEvidence(undefined)
    void historyApi.getSkillCandidates(projectId)
      .then(value => { if (valid) setReport(value) })
      .catch(() => { if (valid) { setReport(null) } })
    return () => { valid = false }
  }, [projectId])

  const title = (item: SkillCandidate): string => {
    if (item.kind === 'repeated-verification') {
      return t('多次执行验证检查', 'Repeated verification checks')
    }
    if (item.kind === 'save-and-verification') {
      return t('反复出现的文件保存与验证活动', 'Repeated save and verification activity')
    }
    return t('反复修改同一文件', 'Repeated edits to the same file')
  }
  const observation = (item: SkillCandidate): string => {
    if (item.kind === 'repeated-verification') {
      return t('在不同工作片段中多次观察到测试或构建结果，但不知道具体执行命令及步骤。',
        item.observation)
    }
    if (item.kind === 'save-and-verification') {
      return t('同一个工作片段内观察到保存和验证事件，但尚不能确定先后顺序或因果关系。',
        item.observation)
    }
    return t('多个工作片段反复修改了同一文件，但无法得知每次修改的操作是否相同。',
      item.observation)
  }
  const missing = (item: SkillCandidate): readonly string[] => {
    if (!zh) return item.missingEvidence
    if (item.kind === 'repeated-verification') {
      return ['具体命令与执行目标', '通过标准及失败处理', '环境、依赖和执行权限']
    }
    if (item.kind === 'save-and-verification') {
      return ['编辑和验证的实际先后关系', '具体文件、命令和运行环境', '验收标准及失败回退']
    }
    return ['实际编辑步骤及各次修改是否类似', '预期成果及执行权限', '必要的验证或复核环节']
  }

  return React.createElement('section', { className: 'ch-skill-section' },
    React.createElement('h3', null, t('可沉淀的 Skill 候选', 'Suggested Skill candidates')),
    React.createElement('p', { className: 'ch-muted' },
      t('仅发现重复模式，不会自动创建、安装或执行 Skill；证据不足时不生成候选。',
        'Discovery only. No Skill is generated, installed, or executed; weak patterns are omitted.')),
    report === undefined
      ? React.createElement('p', { className: 'ch-muted', role: 'status' },
          t('正在检查重复模式…', 'Checking for repeated patterns…'))
      : report === null
        ? React.createElement('p', { className: 'ch-muted', role: 'alert' },
            t('读取候选失败。', 'Could not load Skill suggestions.'))
        : report.candidates.length === 0
          ? React.createElement('p', { className: 'ch-muted' },
              t('历史证据不足，暂不建议创建 Skill。',
                'Not enough independent history to recommend a Skill.'))
          : React.createElement('ul', { className: 'ch-skill-list' },
              ...report.candidates.map(item => React.createElement('li', {
                key: item.id, className: 'ch-skill-candidate',
              },
              React.createElement('strong', null, title(item)),
              React.createElement('p', { className: 'ch-muted' },
                t('不同工作片段 ', 'Distinct Episodes: ') + item.episodeCount
                  + t(' 个 · 跨 ', ' · Days: ') + item.distinctDayCount
                  + t(' 天', '')),
              React.createElement('p', null, observation(item)),
              React.createElement('strong', { className: 'ch-skill-subtitle' },
                t('还缺少的关键步骤', 'What still needs confirmation')),
              React.createElement('ul', { className: 'ch-skill-missing' },
                ...missing(item).map((line, idx) =>
                  React.createElement('li', { key: idx }, line))),
              React.createElement('button', {
                type: 'button', className: 'ch-text-action',
                'aria-expanded': openEvidence === item.id,
                onClick: () => setOpenEvidence(openEvidence === item.id
                  ? undefined : item.id),
              }, openEvidence === item.id
                ? t('收起证据', 'Hide evidence')
                : t('查看 Episode 证据', 'Show Episode evidence')),
              openEvidence === item.id
                ? React.createElement('div', { className: 'ch-skill-evidence' },
                    React.createElement('p', { className: 'ch-muted' },
                      t('来源工作片段（仅 ID）：', 'Source Episode IDs:')),
                    ...item.evidenceEpisodeIds.map(id =>
                      React.createElement('code', { key: id }, id)),
                    item.evidenceTruncated
                      ? React.createElement('p', { className: 'ch-muted' },
                          t('证据列表已截断。', 'Evidence list truncated.'))
                      : null,
                  ) : null,
              ))),
    report?.scanTruncated
      ? React.createElement('p', { className: 'ch-muted' },
          t('历史扫描存在上限，可能遗漏其他模式。',
            'History scan is bounded; further patterns may be omitted.'))
      : null,
  )
}
