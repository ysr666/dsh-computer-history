import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { AskHistoryView } from '../../src/client/ask-history-view.js'
import { historyApi } from '../../src/client/api.js'
import { ASK_HISTORY_STYLES } from '../../src/client/styles/ask-history.js'
import type { AskHistoryResult, EpisodeDetail } from '../../src/shared/index.js'

type Props = React.ComponentProps<typeof AskHistoryView>
type Node = ReactElement<Record<string, any>>

/**
 * Hooks-only surface harness: exercises the actual React component's event
 * handlers and text/visibility with no browser, network or extra packages.
 * NOT a pixel/layout render, and not a claim that the installed DSH UI works.
 */
function surface(props: Props) {
  const slots: unknown[] = []
  const refs: unknown[] = []
  let index = 0
  const stateSpy = vi.spyOn(React, 'useState').mockImplementation((initial?: unknown) => {
    const idx = index++
    if (!(idx in slots)) slots[idx] = initial
    return [
      slots[idx],
      (value: unknown) => {
        slots[idx] = typeof value === 'function'
          ? (value as (old: unknown) => unknown)(slots[idx])
          : value
      },
    ] as never
  })
  const refSpy = vi.spyOn(React, 'useRef').mockImplementation((initial?: unknown) => {
    const idx = index++
    if (!(idx in refs)) refs[idx] = { current: initial }
    return refs[idx] as never
  })
  const effectSpy = vi.spyOn(React, 'useEffect').mockImplementation(() => {})
  function render(): Node {
    index = 0
    return AskHistoryView(props) as Node
  }
  return {
    render, close: () => { stateSpy.mockRestore(); refSpy.mockRestore(); effectSpy.mockRestore() },
  }
}

function elements(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object') return []
  if (!('type' in node) || !('props' in node)) return []
  const el = node as Node
  return [el, ...elements(el.props.children)]
}
function label(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(label).join('')
  if (!node || typeof node !== 'object') return ''
  return label((node as Node).props?.children)
}
function namedButton(root: Node, text: string) {
  const buttons = elements(root).filter(el => el.type === 'button')
  const button = buttons.find(el => label(el.props.children).includes(text))
  if (!button) throw new Error('Button not rendered: ' + text
    + '; actual: ' + buttons.map(el => label(el.props.children)).join(' / '))
  return button
}
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
function result(): AskHistoryResult {
  return {
    query: 'cad',
    strategy: 'deterministic',
    scannedEpisodeCount: 1, scanTruncated: false,
    items: [{
      id: 'synthetic-hit', kind: 'file', title: 'joint.step',
      episodeId: 'episode:cad', observedAtMs: 1000,
      workspaceTitle: 'QA-RobotArm',
      evidenceLevel: 'episode-compacted',
      provenance: 'recorded',
    }],
  } as unknown as AskHistoryResult
}
function episode(id = 'episode:cad'): EpisodeDetail {
  return {
    id, startedAtMs: 10, endedAtMs: 1000, state: 'closed',
    summary: 'Synthetic CAD Episode',
    workspace: { id: 'QA-RobotArm', title: 'QA-RobotArm' },
    resources: [], surfaces: [], summaryObservationIds: [],
  } as unknown as EpisodeDetail
}

afterEach(() => vi.restoreAllMocks())

describe('History page AI/local/Continue event integration', () => {
  it('renders both AI and local search, and AI only prepares a question without local searching', async () => {
    const ai = vi.fn().mockResolvedValue(undefined)
    const local = vi.spyOn(historyApi, 'askHistory').mockResolvedValue(result())
    const ui = surface({ locale: 'zh-CN', historyRevision: 0, onAskWithAi: ai })
    try {
      let root = ui.render()
      namedButton(root, '查询工作历史').props.onClick()
      root = ui.render()
      const input = elements(root).find(el => el.type === 'input')
      expect(input).toBeDefined()
      input!.props.onChange({ target: { value: '昨天保存了哪个模型？' } })
      root = ui.render()
      expect(namedButton(root, '在 DSH 中询问 AI')).toBeDefined()
      expect(namedButton(root, '本地快速查找')).toBeDefined()
      namedButton(root, '在 DSH 中询问 AI').props.onClick?.()
      // submit button only handles form submission; emulate DOM submit instead
      const form = elements(root).find(el => el.type === 'form')!
      const preventDefault = vi.fn()
      form.props.onSubmit({ preventDefault })
      await settle()
      expect(preventDefault).toHaveBeenCalled()
      expect(ai).toHaveBeenCalledExactlyOnceWith('昨天保存了哪个模型？')
      expect(local).not.toHaveBeenCalled()
    } finally { ui.close() }
  })

  it('shows exact source and continues the Episode chosen in the local results', async () => {
    vi.spyOn(historyApi, 'askHistory').mockResolvedValue(result())
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode())
    const onContinue = vi.fn().mockResolvedValue(undefined)
    const ui = surface({ locale: 'en-US', historyRevision: 0, onContinue })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      elements(root).find(el => el.type === 'input')!.props.onChange({ target: { value: 'cad' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form')!.props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      expect(label(root)).toContain('joint.step')
      expect(namedButton(root, 'Continue this work')).toBeDefined()
      namedButton(root, 'Inspect source Episode').props.onClick()
      await settle()
      root = ui.render()
      expect(label(root)).toContain('Synthetic CAD Episode')
      namedButton(root, 'Continue this work').props.onClick()
      await settle()
      expect(onContinue).toHaveBeenCalledExactlyOnceWith(episode())
    } finally { ui.close() }
  })

  it('refuses a stale source and displays an error without continuing anything', async () => {
    vi.spyOn(historyApi, 'askHistory').mockResolvedValue(result())
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode('episode:wrong'))
    const onContinue = vi.fn()
    const ui = surface({ locale: 'zh-CN', historyRevision: 0, onContinue })
    try {
      let root = ui.render()
      namedButton(root, '查询工作历史').props.onClick()
      root = ui.render()
      elements(root).find(el => el.type === 'input')!.props.onChange({ target: { value: '模型' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form')!.props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      namedButton(root, '继续此项工作').props.onClick()
      await settle()
      expect(onContinue).not.toHaveBeenCalled()
      root = ui.render()
      expect(elements(root).find(el => el.props.role === 'alert')).toBeDefined()
    } finally { ui.close() }
  })
})

describe('AI source Episode → explicit Continue bridge', () => {
  it('requires inspect then an explicit Continue click; the action reloads the exact ID', async () => {
    const reader = vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode())
    const onContinue = vi.fn().mockResolvedValue(undefined)
    const ai = vi.fn().mockResolvedValue(undefined)
    const ui = surface({ locale: 'zh-CN', historyRevision: 0, onAskWithAi: ai, onContinue })
    try {
      let root = ui.render()
      namedButton(root, '查询工作历史').props.onClick()
      root = ui.render()
      const exact = elements(root).find(el =>
        el.type === 'input' && el.props['aria-label'] === '来源 Episode ID')
      expect(exact).toBeDefined()
      expect(namedButton(root, '核对 Episode 来源')).toBeDefined()
      expect(label(root)).not.toContain('继续此 Episode')
      exact!.props.onChange({ target: { value: '  episode:cad  ' } })
      root = ui.render()
      const form = elements(root).find(el => el.type === 'form'
        && el.props.className === 'ch-ask-form'
        && elements(el).some(child => child.props['aria-label'] === '来源 Episode ID'))!
      form.props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      expect(label(root)).toContain('Synthetic CAD Episode')
      expect(namedButton(root, '继续此 Episode')).toBeDefined()
      expect(onContinue).not.toHaveBeenCalled()
      namedButton(root, '继续此 Episode').props.onClick()
      await settle()
      expect(reader).toHaveBeenCalledTimes(2)
      expect(reader).toHaveBeenNthCalledWith(1, 'episode:cad')
      expect(reader).toHaveBeenNthCalledWith(2, 'episode:cad')
      expect(onContinue).toHaveBeenCalledExactlyOnceWith(episode())
    } finally { ui.close() }
  })

  it('does not show the AI-source bridge when the AI callback is unavailable', () => {
    const ui = surface({ locale: 'en-US', historyRevision: 0, onContinue: vi.fn() })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      expect(elements(root).filter(el => el.props['aria-label'] === 'Source Episode ID'))
        .toHaveLength(0)
    } finally { ui.close() }
  })

  it('rejects a forged Episode response and never offers Continue', async () => {
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode('episode:other'))
    const onContinue = vi.fn()
    const ui = surface({ locale: 'en-US', historyRevision: 0,
      onAskWithAi: vi.fn(), onContinue })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      const input = elements(root).find(el => el.props['aria-label'] === 'Source Episode ID')!
      input.props.onChange({ target: { value: 'episode:cad' } })
      root = ui.render()
      namedButton(root, 'Inspect Episode source').props.onClick?.()
      const form = elements(root).find(el => el.type === 'form'
        && elements(el).some(child => child.props['aria-label'] === 'Source Episode ID'))!
      form.props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      expect(elements(root).find(el => el.props.role === 'alert')).toBeDefined()
      expect(label(root)).not.toContain('Continue this Episode')
      expect(onContinue).not.toHaveBeenCalled()
    } finally { ui.close() }
  })

  it('does not continue a source deleted between preview and click', async () => {
    const reader = vi.spyOn(historyApi, 'getEpisode')
      .mockResolvedValueOnce(episode())
      .mockRejectedValueOnce(new Error('expired'))
    const onContinue = vi.fn()
    const ui = surface({ locale: 'en-US', historyRevision: 0,
      onAskWithAi: vi.fn(), onContinue })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      elements(root).find(el => el.props['aria-label'] === 'Source Episode ID')!
        .props.onChange({ target: { value: 'episode:cad' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form'
        && elements(el).some(child => child.props['aria-label'] === 'Source Episode ID'))!
        .props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      namedButton(root, 'Continue this Episode').props.onClick()
      await settle()
      root = ui.render()
      expect(reader).toHaveBeenCalledTimes(2)
      expect(onContinue).not.toHaveBeenCalled()
      expect(elements(root).find(el => el.props.role === 'alert')).toBeDefined()
      expect(label(root)).not.toContain('Continue this Episode')
    } finally { ui.close() }
  })

  it('clears an inspected source immediately when the pasted ID is changed', async () => {
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode())
    const ui = surface({ locale: 'en-US', historyRevision: 0,
      onAskWithAi: vi.fn(), onContinue: vi.fn() })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      elements(root).find(el => el.props['aria-label'] === 'Source Episode ID')!
        .props.onChange({ target: { value: 'episode:cad' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form'
        && elements(el).some(child => child.props['aria-label'] === 'Source Episode ID'))!
        .props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      expect(label(root)).toContain('Continue this Episode')
      elements(root).find(el => el.props['aria-label'] === 'Source Episode ID')!
        .props.onChange({ target: { value: 'episode:different' } })
      root = ui.render()
      expect(label(root)).not.toContain('Continue this Episode')
    } finally { ui.close() }
  })
})

describe('AI Episode preview async isolation', () => {
  it('ignores an older lookup that completes after the user changes the ID', async () => {
    let release: ((value: EpisodeDetail) => void) | undefined
    vi.spyOn(historyApi, 'getEpisode').mockImplementation(
      () => new Promise<EpisodeDetail>(resolve => { release = resolve }),
    )
    const onContinue = vi.fn()
    const ui = surface({ locale: 'en-US', historyRevision: 0,
      onAskWithAi: vi.fn(), onContinue })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      elements(root).find(el => el.props['aria-label'] === 'Source Episode ID')!
        .props.onChange({ target: { value: 'episode:cad' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form'
        && elements(el).some(child => child.props['aria-label'] === 'Source Episode ID'))!
        .props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      elements(root).find(el => el.props['aria-label'] === 'Source Episode ID')!
        .props.onChange({ target: { value: 'episode:other' } })
      release?.(episode())
      await settle()
      root = ui.render()
      expect(label(root)).not.toContain('Continue this Episode')
      expect(onContinue).not.toHaveBeenCalled()
    } finally { ui.close() }
  })
})


describe('Episode source preview accessibility and compact layout', () => {
  it('displays workspace, time, at most 3 historical resources and an explicit caution', async () => {
    const preview = {
      ...episode(),
      resources: ['joint.step', 'test-log.txt', 'assembly.step', 'fourth.step']
        .map((name, i) => ({
          kind: 'file' as const,
          canonicalUri: 'file:///synthetic/QA-RobotArm/' + name,
          displayLabel: name, firstSeenAtMs: 1, lastSeenAtMs: 2,
          observationCount: 1 + i,
        })),
    }
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(preview)
    const ui = surface({ locale: 'en-US', historyRevision: 0,
      onAskWithAi: vi.fn(), onContinue: vi.fn() })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      elements(root).find(el => el.props['aria-label'] === 'Source Episode ID')!
        .props.onChange({ target: { value: 'episode:cad' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form'
        && elements(el).some(child => child.props['aria-label'] === 'Source Episode ID'))!
        .props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      const previewRegion = elements(root).find(el =>
        el.props.role === 'region'
        && el.props['aria-label'] === 'Historical source awaiting confirmation')
      expect(previewRegion).toBeDefined()
      const previewText = label(previewRegion)
      expect(previewText).toContain('QA-RobotArm')
      expect(previewText).toContain('joint.step')
      expect(previewText).toContain('test-log.txt')
      expect(previewText).toContain('assembly.step')
      expect(previewText).not.toContain('fourth.step')
      expect(previewText).toContain('not proof the file still exists')
    } finally { ui.close() }
  })

  it('keeps the input and action buttons inside narrow DSH slots', () => {
    expect(ASK_HISTORY_STYLES).toContain('.ch-ask-input{min-width:0;max-width:100%')
    expect(ASK_HISTORY_STYLES).toContain('.ch-ask-form>.ch-input{flex:1 1 100%')
    expect(ASK_HISTORY_STYLES).toContain('overflow-wrap:anywhere')
    expect(ASK_HISTORY_STYLES).toContain('.ch-ask-exact-preview>.ch-button{width:100%')
  })
})

async function inspectWith(record: EpisodeDetail) {
  vi.spyOn(historyApi, 'askHistory').mockResolvedValue(result())
  const reader = vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(record)
  const ui = surface({ locale: 'en-US', historyRevision: 0, onContinue: vi.fn() })
  try {
    let root = ui.render()
    namedButton(root, 'Explore Work History').props.onClick()
    root = ui.render()
    elements(root).find(el => el.type === 'input')!
      .props.onChange({ target: { value: 'cad' } })
    root = ui.render()
    elements(root).find(el => el.type === 'form')!
      .props.onSubmit({ preventDefault() {} })
    await settle()
    root = ui.render()
    namedButton(root, 'Inspect source Episode').props.onClick()
    await settle()
    return { root: ui.render(), reader }
  } finally { ui.close() }
}

describe('Local result source inspection must match the selected Episode', () => {

  it('never displays a different Episode returned by a stale or incorrect Host response', async () => {
    const { root, reader } = await inspectWith({
      ...episode('episode:unrelated'), summary: 'UNRELATED PROJECT SECRET',
    })
    expect(reader).toHaveBeenCalledExactlyOnceWith('episode:cad')
    expect(label(root)).not.toContain('UNRELATED PROJECT SECRET')
    expect(elements(root).find(el => el.props.role === 'alert')).toBeDefined()
  })

  it('rejects an invalidated Episode instead of showing it as a valid source', async () => {
    const { root } = await inspectWith({
      ...episode(), state: 'invalidated',
      summary: 'INVALIDATED OLD SOURCE',
    } as EpisodeDetail)
    expect(label(root)).not.toContain('INVALIDATED OLD SOURCE')
    expect(elements(root).find(el => el.props.role === 'alert')).toBeDefined()
  })
})

describe('Source provenance placement and accessible actions', () => {
  it('puts the source beneath only its selected result and names actions by result', async () => {
    const initial = result()
    const rows = [
      ...initial.items,
      { ...initial.items[0]!, id: 'second-hit',
        title: 'another-project.txt', episodeId: 'episode:second' },
    ]
    vi.spyOn(historyApi, 'askHistory').mockResolvedValue({
      ...initial, items: rows,
    })
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode())
    const ui = surface({ locale: 'en-US', historyRevision: 0, onContinue: vi.fn() })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      elements(root).find(el => el.type === 'input')!
        .props.onChange({ target: { value: 'projects' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form')!
        .props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      const items = elements(root).filter(el =>
        el.type === 'li' && el.props.className === 'ch-ask-hit')
      expect(items).toHaveLength(2)
      expect(elements(items[0]).find(el =>
        el.props['aria-label'] === 'Inspect source: joint.step')).toBeDefined()
      expect(elements(items[1]).find(el =>
        el.props['aria-label'] === 'Continue work: another-project.txt')).toBeDefined()
      elements(items[0]).find(el =>
        el.props['aria-label'] === 'Inspect source: joint.step')!
        .props.onClick()
      await settle()
      root = ui.render()
      const updatedItems = elements(root).filter(el =>
        el.type === 'li' && el.props.className === 'ch-ask-hit')
      expect(label(updatedItems[0])).toContain('Synthetic CAD Episode')
      expect(label(updatedItems[1])).not.toContain('Synthetic CAD Episode')
      expect(elements(updatedItems[0]).find(el =>
        el.props.role === 'region'
        && el.props['aria-label'] === 'Source for selected result')).toBeDefined()
    } finally { ui.close() }
  })
})

describe('Continue duplicate-submit prevention', () => {
  it('invokes local hit Continue once even if the user double clicks before React rerenders', async () => {
    vi.spyOn(historyApi, 'askHistory').mockResolvedValue(result())
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode())
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const onContinue = vi.fn().mockReturnValue(pending)
    const ui = surface({ locale: 'en-US', historyRevision: 0, onContinue })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      elements(root).find(el => el.type === 'input')!
        .props.onChange({ target: { value: 'cad' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form')!
        .props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      const click = namedButton(root, 'Continue this work').props.onClick
      click()
      click()
      await settle()
      expect(onContinue).toHaveBeenCalledTimes(1)
      finish()
      await settle()
    } finally { ui.close() }
  })

  it('invokes exact Episode Continue once even if the user double clicks the preview button', async () => {
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode())
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const onContinue = vi.fn().mockReturnValue(pending)
    const ui = surface({ locale: 'en-US', historyRevision: 0,
      onAskWithAi: vi.fn(), onContinue })
    try {
      let root = ui.render()
      namedButton(root, 'Explore Work History').props.onClick()
      root = ui.render()
      elements(root).find(el => el.props['aria-label'] === 'Source Episode ID')!
        .props.onChange({ target: { value: 'episode:cad' } })
      root = ui.render()
      elements(root).find(el => el.type === 'form'
        && elements(el).some(child => child.props['aria-label'] === 'Source Episode ID'))!
        .props.onSubmit({ preventDefault() {} })
      await settle()
      root = ui.render()
      const click = namedButton(root, 'Continue this Episode').props.onClick
      click()
      click()
      await settle()
      expect(onContinue).toHaveBeenCalledTimes(1)
      finish()
      await settle()
    } finally { ui.close() }
  })
})
