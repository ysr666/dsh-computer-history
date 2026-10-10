import React from 'react'
import type { AutomationCandidate, AutomationCandidateReport } from '../shared/index.js'
import { historyApi } from './api.js'

interface Props {
  readonly projectId: string
  readonly projectTitle: string
  readonly locale: string
}

function reminderDraft(
  item: AutomationCandidate, projectTitle: string, zh: boolean,
): string {
  const action = item.observedActivity === 'test'
    ? (zh ? '测试' : 'test') : (zh ? '构建' : 'build')
  const suggested = item.cadence === 'daily-pattern'
    ? (zh ? '每日' : 'daily') : (zh ? '每周' : 'weekly')
  return zh
    ? [
      '待人工确认的提醒草稿（尚未创建自动化）',
      '项目：' + projectTitle,
      '目的：定期提醒我人工检查该项目历史' + action + '结果。',
      '观察到的日期节奏：' + suggested + '（仅历史迹象，不代表确认频率）',
      '时间、时区、通知位置、结束日期：由我另行决定。',
      '权限：仅发送提醒；不得自行执行命令、读取文件正文或访问外部服务。',
    ].join('\n')
    : [
      'REVIEW DRAFT — no automation has been created',
      'Project: ' + projectTitle,
      'Purpose: remind me to manually review historical ' + action + ' results.',
      'Observed date pattern: ' + suggested + ' (not an approved schedule).',
      'Time, timezone, notification destination and end date: to be chosen by me.',
      'Permissions: reminder only; do not run commands, read file contents, or access external services.',
    ].join('\n')
}

export function AutomationCandidatesView({
  projectId, projectTitle, locale,
}: Props): React.ReactElement {
  const zh = locale.toLowerCase().startsWith('zh')
  const t = (cn: string, en: string): string => zh ? cn : en
  const [report, setReport] = React.useState<AutomationCandidateReport | null>()
  const [openCandidate, setOpenCandidate] = React.useState<string>()

  React.useEffect(() => {
    let valid = true
    setReport(undefined)
    setOpenCandidate(undefined)
    void historyApi.getAutomationCandidates(projectId)
      .then(value => { if (valid) setReport(value) })
      .catch(() => { if (valid) setReport(null) })
    return () => { valid = false }
  }, [projectId])

  return React.createElement('section', { className: 'ch-auto-section' },
    React.createElement('h3', null, t('定期提醒候选', 'Suggested automations')),
    React.createElement('p', { className: 'ch-muted' },
      t('仅根据历史日期节奏提示是否值得设置提醒；不会自行制定时间、创建任务或执行命令。',
        'Historical cadence hints only. No time is chosen, no task is scheduled, and no commands are run.')),
    report === undefined
      ? React.createElement('p', { role: 'status', className: 'ch-muted' },
          t('正在分析周期性证据…', 'Checking historical cadence…'))
      : report === null
        ? React.createElement('p', { role: 'alert', className: 'ch-muted' },
            t('暂时无法读取提醒候选。', 'Automation suggestions are unavailable.'))
        : report.candidates.length === 0
          ? React.createElement('p', { className: 'ch-muted' },
              t('没有观察到足够稳定的日历节奏，暂不建议设置周期性提醒。',
                'No sufficiently stable calendar pattern was found.'))
          : React.createElement('ul', { className: 'ch-auto-list' },
              ...report.candidates.map(item => React.createElement('li', {
                key: item.id, className: 'ch-auto-candidate',
              },
              React.createElement('strong', null,
                t(item.observedActivity === 'test'
                  ? '定期复核测试结果' : '定期复核构建结果',
                item.observedActivity === 'test'
                  ? 'Review test results' : 'Review build results')),
              React.createElement('p', { className: 'ch-muted' },
                t('观察到', 'Observed ')
                + (item.cadence === 'daily-pattern'
                  ? t('近似每日', 'near-daily')
                  : t('近似每周', 'near-weekly'))
                + t('节奏 · 有证据日期 ', ' pattern · Evidence dates: ')
                + item.distinctDayCount),
              React.createElement('p', null,
                t('只是工作时间的重复现象，并不证明这些工作应当自动执行。',
                  item.observation)),
              React.createElement('button', {
                type: 'button', className: 'ch-text-action',
                'aria-expanded': openCandidate === item.id,
                onClick: () => setOpenCandidate(openCandidate === item.id
                  ? undefined : item.id),
              }, openCandidate === item.id
                ? t('收起证据与草稿', 'Hide evidence and draft')
                : t('查看证据与提醒草稿', 'Review evidence and draft')),
              openCandidate === item.id
                ? React.createElement('div', { className: 'ch-auto-detail' },
                    React.createElement('p', null,
                      t('历史日期（UTC，仅作证据）：', 'Historical UTC dates (evidence only): '),
                      item.observedOnDaysUtc.join(' · ')),
                    React.createElement('p', { className: 'ch-muted' },
                      t('来源 Episode：', 'Source Episodes:')),
                    ...item.sourceEpisodeIds.map(id =>
                      React.createElement('code', { key: id }, id)),
                    item.evidenceTruncated
                      ? React.createElement('p', { className: 'ch-muted' },
                          t('来源列表已截断。', 'Source list truncated.')) : null,
                    React.createElement('p', { className: 'ch-muted' },
                      t('仍需要确认：目标、频率、确切时间、时区、通知位置与权限。',
                        'Still to decide: goal, frequency, exact time, timezone, destination and permissions.')),
                    React.createElement('label', { className: 'ch-auto-label' },
                      t('仅供复制修改的草稿（不会保存或创建自动化）',
                        'Editable-by-copy draft (not saved or scheduled)')),
                    React.createElement('textarea', {
                      className: 'ch-auto-draft',
                      value: reminderDraft(item, projectTitle, zh),
                      readOnly: true,
                      rows: 7,
                      'aria-label': t('提醒草稿', 'Reminder draft'),
                      onFocus: (event: React.FocusEvent<HTMLTextAreaElement>) =>
                        event.currentTarget.select(),
                    }),
                  ) : null,
              ))),
    report?.scanTruncated
      ? React.createElement('p', { className: 'ch-muted' },
          t('分析有扫描上限，部分模式可能未被发现。',
            'The scan is bounded, so some patterns may be missed.'))
      : null,
  )
}
