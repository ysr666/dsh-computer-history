import React from 'react'
import type { MemoryFact, ProjectMemory, ThreadActivityLinks, UserMemoryNote } from '../shared/index.js'
import { historyApi } from './api.js'

interface WorkMemoryViewProps {
  readonly locale: string
  readonly historyRevision: number
}

function factLabel(fact: MemoryFact, zh: boolean): string {
  if (!zh) return fact.text
  const text = fact.text
  if (fact.kind === 'workspace') return '工作区：' + text.replace(/^Workspace: /, '')
  if (fact.kind === 'resource') return '最近使用：' + text.replace(/^Recently used: /, '')
  if (fact.kind === 'save') return '观察到保存：' + text.replace(/^Observed save: /, '')
  if (fact.kind === 'activity') return '观察到应用活动：' + text.replace(/^Observed app: /, '')
  const m = /^Historically observed (build|test|other) (success|failure)/.exec(text)
  if (m) {
    return '历史' + (m[1] === 'test' ? '测试' : m[1] === 'build' ? '构建' : '验证')
      + '曾报告' + (m[2] === 'success' ? '成功' : '失败') + '；当前状态需要重新确认'
  }
  return text
}

/**
 * Persistent notes are never auto-generated or saved by an Agent.
 * UI requires an intentional note, an explicit retention checkbox and Save.
 */
export function WorkMemoryView({ locale, historyRevision }: WorkMemoryViewProps): React.ReactElement {
  const zh = locale.toLowerCase().startsWith('zh')
  const t = (cn: string, en: string): string => zh ? cn : en
  const [expanded, setExpanded] = React.useState(false)
  const [projects, setProjects] = React.useState<readonly ProjectMemory[] | null>()
  const [notes, setNotes] = React.useState<readonly UserMemoryNote[] | null>()
  const [selected, setSelected] = React.useState<ProjectMemory>()
  const [activityLinks, setActivityLinks] = React.useState<ThreadActivityLinks | null>()
  const [linkSource, setLinkSource] = React.useState<string>()
  const [linkEvidence, setLinkEvidence] = React.useState<{
    episodeId: string; activity: string; anchor: string
  }>()
  const [draft, setDraft] = React.useState('')
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [editId, setEditId] = React.useState<string>()
  const [editText, setEditText] = React.useState('')
  const [deleteId, setDeleteId] = React.useState<string>()
  const [shareNoteId, setShareNoteId] = React.useState<string>()
  const [shareConsent, setShareConsent] = React.useState(false)
  const [shareCode, setShareCode] = React.useState<string>()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [restoreFile, setRestoreFile] = React.useState<{
    name: string; document: unknown; count: number;
    preview: readonly { project: string; text: string }[]
  }>()
  const [restoreAcknowledged, setRestoreAcknowledged] = React.useState(false)
  const uploadRef = React.useRef<HTMLInputElement>(null)
  const revision = React.useRef(0)
  const projectRequest = React.useRef(0)
  const evidenceRequest = React.useRef(0)

  React.useEffect(() => {
    const current = ++revision.current
    projectRequest.current += 1
    evidenceRequest.current += 1
    setSelected(undefined)
    setActivityLinks(undefined)
    setLinkSource(undefined)
    setLinkEvidence(undefined)
    setAcknowledged(false)
    setDraft('')
    setEditId(undefined)
    setDeleteId(undefined)
    setShareNoteId(undefined)
    setShareConsent(false)
    setShareCode(undefined)
    setError('')
    setNotice('')
    setRestoreFile(undefined)
    setRestoreAcknowledged(false)
    if (!expanded) return
    setProjects(undefined)
    setNotes(undefined)
    // Long-term notes remain readable even if an Episode-derived projection
    // fails or every short-lived Episode has expired.
    void historyApi.getProjectMemories(20).then(p => {
      if (revision.current === current) setProjects(p)
    }).catch(() => {
      if (revision.current === current) setProjects(null)
    })
    void historyApi.getSavedMemoryNotes().then(n => {
      if (revision.current === current) setNotes(n)
    }).catch(() => {
      if (revision.current === current) {
        setNotes(null)
        setError(t('长期记忆暂时不可用。', 'Saved notes are unavailable.'))
      }
    })
    return () => { revision.current += 1 }
    // The locale affects labels only; capture it upon each data refresh.
  }, [expanded, historyRevision])

  const loadSavedNotes = async (): Promise<void> => {
    const snapshot = revision.current
    const fresh = await historyApi.getSavedMemoryNotes()
    if (revision.current === snapshot) setNotes(fresh)
  }

  const openProject = (id: string): void => {
    const current = ++projectRequest.current
    setError('')
    setNotice('')
    setSelected(undefined)
    setActivityLinks(undefined)
    setLinkSource(undefined)
    setLinkEvidence(undefined)
    evidenceRequest.current += 1
    setDraft('')
    setAcknowledged(false)
    void historyApi.getThreadActivityLinks(id).then(links => {
      if (projectRequest.current === current) setActivityLinks(links)
    }).catch(() => {
      if (projectRequest.current === current) setActivityLinks(null)
    })
    void historyApi.getProjectMemory(id).then(project => {
      if (projectRequest.current === current) setSelected(project)
    }).catch(() => {
      if (projectRequest.current === current) {
        setError(t('此项目已不可用。', 'This project is no longer available.'))
      }
    })
  }

  const inspectLink = async (episodeId: string, anchorId: string): Promise<void> => {
    if (linkSource === episodeId) {
      evidenceRequest.current += 1
      setLinkSource(undefined)
      setLinkEvidence(undefined)
      return
    }
    const current = ++evidenceRequest.current
    const project = projectRequest.current
    setLinkSource(episodeId)
    setLinkEvidence(undefined)
    try {
      const [activity, anchor] = await Promise.all([
        historyApi.getEpisode(episodeId), historyApi.getEpisode(anchorId),
      ])
      if (current === evidenceRequest.current && projectRequest.current === project) {
        setLinkEvidence({
          episodeId,
          activity: activity.summary,
          anchor: anchor.summary,
        })
      }
    } catch {
      if (current === evidenceRequest.current && projectRequest.current === project) {
        setLinkEvidence({
          episodeId,
          activity: t('来源已过期或不可用。', 'Source expired or unavailable.'),
          anchor: '',
        })
      }
    }
  }

  const save = async (): Promise<void> => {
    if (!selected?.recentEpisodeIds[0] || !draft.trim() || !acknowledged || pending) return
    setPending(true)
    setError('')
    try {
      await historyApi.saveMemoryNote({
        projectId: selected.id,
        episodeId: selected.recentEpisodeIds[0],
        text: draft.trim(),
        retentionAcknowledged: true,
      })
      await loadSavedNotes()
      setDraft('')
      setAcknowledged(false)
      setNotice(t('已保存长期记忆。', 'Saved to long-term memory.'))
    } catch {
      setError(t('保存失败；源工作片段可能已过期。', 'Could not save; the source episode may have expired.'))
    } finally {
      setPending(false)
    }
  }

  const update = async (): Promise<void> => {
    if (!editId || !editText.trim() || pending) return
    setPending(true)
    setError('')
    try {
      await historyApi.updateMemoryNote(editId, editText.trim())
      await loadSavedNotes()
      setEditId(undefined)
      setEditText('')
      setNotice(t('修改已保存。', 'Changes saved.'))
    } catch { setError(t('修改失败。', 'Could not update note.')) }
    finally { setPending(false) }
  }

  const remove = async (id: string): Promise<void> => {
    if (deleteId !== id || pending) return
    setPending(true)
    setError('')
    try {
      await historyApi.deleteMemoryNote(id)
      await loadSavedNotes()
      setDeleteId(undefined)
      setEditId(undefined)
      setNotice(t('笔记已删除。', 'Note deleted.'))
    } catch { setError(t('删除失败。', 'Could not delete note.')) }
    finally { setPending(false) }
  }

  const selectRestore = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setRestoreFile(undefined)
    setRestoreAcknowledged(false)
    setError('')
    if (file.size > 1_500_000) {
      setError(t('文件过大，最多 1.5MB。', 'File too large (maximum 1.5MB).'))
      return
    }
    try {
      const document = JSON.parse(await file.text()) as unknown
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new Error('invalid object')
      }
      const backup = document as Record<string, unknown>
      if (backup.schema !== 'dsh-computer-history/v1'
        || typeof backup.schemaVersion !== 'number'
        || backup.schemaVersion < 14
        || !backup.tables || typeof backup.tables !== 'object') {
        throw new Error('unsupported backup')
      }
      const tables = backup.tables as Record<string, unknown>
      if (!Array.isArray(tables.memory_user_notes)
        || !Array.isArray(tables.memory_projects)
        || !Array.isArray(tables.memory_note_apps)
        || tables.memory_user_notes.length > 1000
        || tables.memory_user_notes.length < 1) {
        throw new Error('no notes')
      }
      const names = new Map<string, string>()
      for (const candidate of tables.memory_projects) {
        if (!candidate || typeof candidate !== 'object') continue
        const project = candidate as { id?: unknown; label?: unknown }
        if (typeof project.id === 'string' && typeof project.label === 'string') {
          names.set(project.id, project.label)
        }
      }
      const preview: Array<{ project: string; text: string }> = []
      for (const candidate of tables.memory_user_notes) {
        if (!candidate || typeof candidate !== 'object') throw new Error('invalid note')
        const note = candidate as { project_id?: unknown; note_text?: unknown }
        if (typeof note.project_id !== 'string' || typeof note.note_text !== 'string'
          || !names.has(note.project_id)) throw new Error('invalid note')
        preview.push({ project: names.get(note.project_id)!, text: note.note_text })
      }
      setRestoreFile({
        name: file.name, document,
        count: preview.length, preview,
      })
    } catch {
      setError(t('无法读取有效的长期记忆导出文件。', 'Not a valid long-term notes export.'))
    }
  }

  const restore = async (): Promise<void> => {
    if (!restoreFile || !restoreAcknowledged || pending) return
    setPending(true)
    setError('')
    try {
      const result = await historyApi.restoreSavedNotes(restoreFile.document)
      await loadSavedNotes()
      setRestoreFile(undefined)
      setRestoreAcknowledged(false)
      setNotice(t(
        '长期记忆已恢复：' + result.restored + ' 条，已存在 ' + result.skipped + ' 条。',
        'Restored ' + result.restored + ' notes; ' + result.skipped + ' already existed.',
      ))
    } catch {
      setError(t('恢复失败：文件可能无效或与现有笔记冲突。',
        'Restore failed: invalid backup or an existing note conflict.'))
    } finally {
      setPending(false)
    }
  }

  const closeShare = async (): Promise<void> => {
    if (pending) return
    if (shareCode) {
      setPending(true)
      try {
        await historyApi.revokeAiNoteReadCode(shareCode)
      } catch {
        setError(t('无法撤销读取码；它仍会在十分钟内自动过期。',
          'Could not revoke code; it will still expire after ten minutes.'))
        setPending(false)
        return
      } finally {
        setPending(false)
      }
    }
    setShareNoteId(undefined)
    setShareConsent(false)
    setShareCode(undefined)
  }

  const shareOnce = async (noteId: string): Promise<void> => {
    if (shareNoteId !== noteId || !shareConsent || pending) return
    setPending(true)
    setError('')
    try {
      const grant = await historyApi.issueAiNoteReadCode(noteId)
      setShareCode(grant.code)
      setNotice(t(
        '一次性授权码有效期 10 分钟，使用一次后失效。请仅主动发送给你信任的 DSH 会话。',
        'One-time code expires in 10 minutes or after use. Share only with a DSH session you trust.',
      ))
    } catch {
      setError(t('无法授权读取该笔记。', 'Could not authorise this note.'))
    } finally { setPending(false) }
  }

  const noteCards = notes?.map(note => React.createElement(
    'li', { key: note.id, className: 'ch-memory-note-card' },
    React.createElement('div', { className: 'ch-memory-note-body' },
      React.createElement('strong', null, note.projectLabel),
      React.createElement('p', { className: 'ch-muted' },
        t('用户主动保存 · 可长期保留', 'Saved by you · long-term retention')),
      editId === note.id
        ? React.createElement(React.Fragment, null,
            React.createElement('textarea', {
              'aria-label': t('编辑长期记忆', 'Edit saved memory'),
              className: 'ch-memory-textarea',
              maxLength: 1000,
              rows: 3,
              value: editText,
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setEditText(event.target.value),
            }),
            React.createElement('button', {
              type: 'button', className: 'ch-button',
              disabled: pending || !editText.trim(),
              onClick: () => { void update() },
            }, t('保存修改', 'Save changes')),
            React.createElement('button', {
              type: 'button', className: 'ch-text-action',
              onClick: () => { setEditId(undefined); setEditText('') },
            }, t('取消', 'Cancel')),
          )
        : React.createElement('p', null, note.text),
      editId === note.id ? null : React.createElement(
        'div', { className: 'ch-controls' },
        React.createElement('button', {
          type: 'button', className: 'ch-text-action', disabled: pending,
          onClick: () => {
            setDeleteId(undefined)
            setEditId(note.id)
            setEditText(note.text)
          },
        }, t('编辑', 'Edit')),
        deleteId === note.id
          ? React.createElement(React.Fragment, null,
              React.createElement('button', {
                type: 'button', className: 'ch-button', disabled: pending,
                onClick: () => { void remove(note.id) },
              }, t('确认永久删除', 'Confirm deletion')),
              React.createElement('button', {
                type: 'button', className: 'ch-text-action',
                onClick: () => setDeleteId(undefined),
              }, t('取消', 'Cancel')))
          : React.createElement('button', {
              type: 'button', className: 'ch-text-action',
              disabled: pending,
              onClick: () => setDeleteId(note.id),
            }, t('删除', 'Delete')),
        React.createElement('button', {
          type: 'button', className: 'ch-text-action', disabled: pending,
          onClick: () => {
            if (shareCode) {
              void closeShare()
              return
            }
            setShareNoteId(shareNoteId === note.id ? undefined : note.id)
            setShareConsent(false)
          },
        }, t('授权 AI 读取一次', 'Allow one AI read')),
      ),
      shareNoteId === note.id && editId !== note.id
        ? React.createElement('div', { className: 'ch-memory-share' },
            React.createElement('p', { className: 'ch-muted' },
              t(
                '仅授权这一条笔记。生成的一次性码必须由你主动发送给 DSH 中的 AI；笔记正文可能进入你当前配置的模型（包括远程模型）上下文。',
                'Authorise exactly this note. You must personally provide the one-time code to DSH. Its text may enter the context of your configured model, including a remote model.',
              )),
            React.createElement('p', { className: 'ch-muted' },
              t('此授权仅控制 Computer History 提供的 AI 读取工具，不代表对其他本地文件访问工具的系统级隔离。',
                'This permission controls the Computer History AI tool, not OS-level access by other local file tools.')),
            React.createElement('label', { className: 'ch-memory-checkbox' },
              React.createElement('input', {
                type: 'checkbox', checked: shareConsent,
                disabled: shareCode !== undefined,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                  setShareConsent(event.target.checked),
              }),
              t('我已了解上述 AI 读取范围与可能的模型外发。', 'I understand the AI read scope and possible model disclosure.')),
            shareCode
              ? React.createElement('div', null,
                  React.createElement('label', { className: 'ch-muted' },
                    t('一次性读取码（点击文本框后手动复制）', 'One-time code (select to copy)')),
                  React.createElement('input', {
                    type: 'text', readOnly: true, value: shareCode,
                    className: 'ch-input ch-memory-code',
                    'aria-label': t('一次性读取码', 'One-time access code'),
                    onFocus: (event: React.FocusEvent<HTMLInputElement>) =>
                      event.currentTarget.select(),
                  }),
                )
              : React.createElement('button', {
                  type: 'button', className: 'ch-button',
                  disabled: pending || !shareConsent,
                  onClick: () => { void shareOnce(note.id) },
                }, t('生成一次性读取码', 'Generate one-time code')),
            React.createElement('button', {
              type: 'button', className: 'ch-text-action',
              onClick: () => { void closeShare() },
            }, shareCode ? t('撤销读取码并关闭', 'Revoke code and close')
              : t('关闭', 'Close')),
          )
        : null,
    ),
  ))

  return React.createElement(
    'div', { className: 'ch-work-memory' },
    React.createElement('button', {
      type: 'button', className: 'ch-text-action ch-memory-toggle',
      'aria-expanded': expanded,
      onClick: () => setExpanded(value => !value),
    }, t('工作记忆 · 项目与已保存笔记', 'Work memory · Projects and saved notes')),
    expanded ? React.createElement('div', { className: 'ch-work-memory-body' },
      React.createElement('p', { className: 'ch-muted' },
        t('自动工作线索随历史过期；只有经你确认的笔记才会长期保存。',
          'Derived work history expires; only notes you explicitly confirm are kept long-term.')),
      React.createElement('h3', null, t('已保存的长期记忆', 'Saved long-term notes')),
      notes === undefined
        ? React.createElement('p', { className: 'ch-muted', role: 'status' },
            t('读取中…', 'Loading…'))
        : notes === null
          ? React.createElement('p', { className: 'ch-muted' },
              t('暂时无法读取。', 'Unavailable.'))
          : notes.length === 0
            ? React.createElement('p', { className: 'ch-muted' },
                t('没有保存的笔记。', 'No saved notes.'))
            : React.createElement('ul', { className: 'ch-memory-note-list' }, ...noteCards ?? []),
      React.createElement('details', { className: 'ch-inspector' },
        React.createElement('summary', null,
          t('从导出文件恢复长期笔记', 'Restore long-term notes from export')),
        React.createElement('p', { className: 'ch-muted' },
          t('普通历史导入不会恢复长期笔记。你需要单独选择文件、检查数量并确认保留。',
            'Normal history import does not restore long-term notes. Review a backup and opt in here.')),
        React.createElement('input', {
          type: 'file',
          ref: uploadRef,
          accept: '.json,application/json',
          className: 'ch-visually-hidden',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            void selectRestore(event)
          },
        }),
        React.createElement('button', {
          type: 'button', className: 'ch-button', disabled: pending,
          onClick: () => uploadRef.current?.click(),
        }, t('选择笔记导出文件', 'Choose notes export')),
        restoreFile ? React.createElement(React.Fragment, null,
          React.createElement('p', null, restoreFile.name),
          React.createElement('p', { className: 'ch-muted' },
            t('准备恢复 ' + restoreFile.count + ' 条长期笔记。',
              'Ready to restore ' + restoreFile.count + ' long-term notes.')),
          React.createElement('details', null,
            React.createElement('summary', null,
              t('查看待恢复笔记的完整内容', 'Review every note to restore')),
            React.createElement('ul', {
              className: 'ch-memory-list',
              style: { maxHeight: 240, overflowY: 'auto' },
            }, ...restoreFile.preview.map((note, i) => React.createElement(
              'li', { key: i },
              React.createElement('strong', null, note.project),
              React.createElement('p', null, note.text),
            ))),
          ),
          React.createElement('label', { className: 'ch-memory-checkbox' },
            React.createElement('input', {
              type: 'checkbox', checked: restoreAcknowledged,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                setRestoreAcknowledged(event.target.checked),
            }),
            ' ',
            t('我已核对文件，并明确同意恢复这些长期保留的笔记。',
              'I reviewed this backup and explicitly agree to restore these long-term notes.')),
          React.createElement('button', {
            type: 'button', className: 'ch-button',
            disabled: pending || !restoreAcknowledged,
            onClick: () => { void restore() },
          }, t('确认恢复', 'Confirm restore')),
        ) : null,
      ),
      React.createElement('h3', null, t('最近的项目线索', 'Recent project context')),
      projects === undefined
        ? React.createElement('p', { className: 'ch-muted', role: 'status' },
            t('读取中…', 'Loading…'))
        : projects === null
          ? React.createElement('p', { className: 'ch-muted' },
              t('暂时无法读取。', 'Unavailable.'))
          : projects.length === 0
            ? React.createElement('p', { className: 'ch-muted' },
                t('暂无可用项目。', 'No recent projects.'))
            : React.createElement('ul', { className: 'ch-memory-list' },
                ...projects.map(project => React.createElement('li', { key: project.id },
                  React.createElement('button', {
                    type: 'button', className: 'ch-text-action',
                    'aria-expanded': selected?.id === project.id,
                    onClick: () => openProject(project.id),
                  }, project.title),
                  React.createElement('span', { className: 'ch-muted' },
                    t(' · 工作片段：', ' · episodes: ') + project.episodeCount),
                )),
              ),
      selected ? React.createElement('section', { className: 'ch-inspector' },
        React.createElement('h3', null, selected.title),
        React.createElement('ul', { className: 'ch-memory-list' },
          ...selected.facts.map(fact => React.createElement('li', { key: fact.id },
            React.createElement('span', null, factLabel(fact, zh)),
            React.createElement('span', { className: 'ch-muted' },
              fact.evidenceLevel === 'episode-compacted'
                ? t(' · 原始记录已过期', ' · Raw records expired')
                : t(' · 有历史记录', ' · Historical record')),
          ))),
        React.createElement('h3', null,
          t('跨应用活动线索', 'Cross-application activity hints')),
        React.createElement('p', { className: 'ch-muted' },
          t('文件完全一致可提供关联证据；仅时间接近不代表属于该项目。不会改变项目归组或继续工作排序。',
            'An exact shared file is evidence of a possible relationship. Nearby activity is not attributed to this project. Neither affects thread grouping or Continue.')),
        activityLinks === undefined
          ? React.createElement('p', { className: 'ch-muted', role: 'status' },
              t('正在分析活动线索…', 'Checking activity links…'))
          : activityLinks === null
            ? React.createElement('p', { className: 'ch-muted' },
                t('暂时无法读取关联线索。', 'Activity links unavailable.'))
            : activityLinks.links.length === 0
              ? React.createElement('p', { className: 'ch-muted' },
                  t('没有足够的独立证据建立额外关联。', 'No additional links supported by available evidence.'))
              : React.createElement('ul', { className: 'ch-memory-link-list' },
                  ...activityLinks.links.map(link => React.createElement(
                    'li', { key: link.episodeId },
                    React.createElement('span', { className: 'ch-memory-link-label' },
                      link.kind === 'exact-resource'
                        ? t('相同文件线索', 'Exact-file link')
                        : t('同期活动 · 未归属', 'Nearby · unattributed')),
                    React.createElement('strong', null, link.label),
                    React.createElement('span', { className: 'ch-muted' },
                      new Date(link.observedAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US')),
                    link.sharedResourceUri
                      ? React.createElement('span', { className: 'ch-muted' },
                          link.sharedResourceUri)
                      : null,
                    React.createElement('button', {
                      type: 'button', className: 'ch-text-action',
                      onClick: () => { void inspectLink(link.episodeId, link.anchorEpisodeId) },
                    }, linkSource === link.episodeId
                      ? t('收起来源', 'Hide source') : t('检查来源', 'Inspect sources')),
                    linkSource === link.episodeId
                      ? React.createElement('div', { className: 'ch-memory-link-evidence' },
                          React.createElement('p', { className: 'ch-muted' },
                            t('活动片段：', 'Activity Episode: ') + link.episodeId
                            + ' · ' + t('项目锚点：', 'Project anchor: ') + link.anchorEpisodeId),
                          linkEvidence?.episodeId === link.episodeId
                            ? React.createElement(React.Fragment, null,
                                React.createElement('p', null, linkEvidence.activity),
                                linkEvidence.anchor
                                  ? React.createElement('p', null, linkEvidence.anchor)
                                  : null,
                              )
                            : React.createElement('p', { role: 'status', className: 'ch-muted' },
                                t('检查中…', 'Inspecting…')),
                        )
                      : null,
                  )),
                ),
        activityLinks?.scanTruncated
          ? React.createElement('p', { className: 'ch-muted' },
              t('检索数量有上限，当前线索并不完整。', 'Bounded scan; links may be incomplete.'))
          : null,
        React.createElement('h3', null, t('为此项目保存笔记', 'Save a note for this project')),
        React.createElement('textarea', {
          rows: 3, maxLength: 1000,
          placeholder: t('填写你希望长期保留的内容（不会自动填入）',
            'Write what you want to remember (never auto-filled)'),
          'aria-label': t('新长期记忆', 'New long-term note'),
          className: 'ch-memory-textarea',
          value: draft,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setDraft(event.target.value),
        }),
        React.createElement('label', { className: 'ch-memory-checkbox' },
          React.createElement('input', {
            type: 'checkbox',
            checked: acknowledged,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
              setAcknowledged(event.target.checked),
          }),
          ' ',
          t('我确认：这条笔记将保留至我主动删除；删除关联历史时也可能被清除。',
            'I understand this note remains until I delete it; forgetting related history may remove it.')),
        React.createElement('button', {
          type: 'button', className: 'ch-button ch-continue-primary',
          disabled: pending || !acknowledged || !draft.trim(),
          onClick: () => { void save() },
        }, t('明确保存', 'Save explicitly')),
      ) : null,
      notice ? React.createElement('p', { role: 'status' }, notice) : null,
      error ? React.createElement('p', { role: 'alert' }, error) : null,
    ) : null,
  )
}
