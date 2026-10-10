// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import { AskHistoryView } from '../../src/client/ask-history-view.js'
import { historyApi } from '../../src/client/api.js'
import { ASK_HISTORY_STYLES } from '../../src/client/styles/ask-history.js'
import type { AskHistoryResult, EpisodeDetail } from '../../src/shared/index.js'

function episode(id = 'episode:cad-1', summary = 'First synthetic CAD episode'): EpisodeDetail {
  return {
    id, state: 'closed', startedAtMs: 50, endedAtMs: 200,
    summary, workspace: { id: 'qa-workspace', title: 'QA-RobotArm' },
    resources: [], surfaces: [], summaryObservationIds: [],
  } as unknown as EpisodeDetail
}

function results(two = false): AskHistoryResult {
  const items = [
    {
      id: 'hit-a', kind: 'file', title: 'joint.step',
      episodeId: 'episode:cad-1', workspaceTitle: 'QA-RobotArm',
      observedAtMs: 100, evidenceLevel: 'episode-compacted', provenance: 'recorded',
    },
    ...(two ? [{
      id: 'hit-b', kind: 'file', title: 'joint.step',
      episodeId: 'episode:cad-2', workspaceTitle: 'QA-RobotArm',
      observedAtMs: 200, evidenceLevel: 'episode-compacted', provenance: 'recorded',
    }] : []),
  ]
  return {
    query: 'joint', strategy: 'deterministic', scannedEpisodeCount: 2,
    scanTruncated: false, items,
  } as unknown as AskHistoryResult
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Ask History real mounted DOM (no actual Electron / no real History)', () => {
  it('opens the real search form; AI prepares an editable question and local search stays separate', async () => {
    const user = userEvent.setup()
    const askAi = vi.fn().mockResolvedValue(undefined)
    const local = vi.spyOn(historyApi, 'askHistory').mockResolvedValue(results())
    render(React.createElement(AskHistoryView, {
      locale: 'en-US', historyRevision: 0, onAskWithAi: askAi,
    }))

    const toggle = screen.getByRole('button', { name: /Explore Work History/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const search = screen.getByRole('searchbox', { name: 'Ask your history' })
    await user.type(search, 'Where is joint.step?')
    await user.click(screen.getByRole('button', { name: 'Ask DSH AI' }))
    await waitFor(() => expect(askAi).toHaveBeenCalledExactlyOnceWith('Where is joint.step?'))
    expect(local).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Quick local search' }))
    await waitFor(() =>
      expect(local).toHaveBeenCalledWith({ query: 'Where is joint.step?', limit: 12 }))
    expect(screen.getByRole('status').textContent).toContain('Found 1 historical leads.')
    expect(screen.getByText('joint.step')).toBeTruthy()
    expect(askAi).toHaveBeenCalledTimes(1)
  })

  it('two same-title results keep source cards and aria-labels bound to the exact hit', async () => {
    const user = userEvent.setup()
    vi.spyOn(historyApi, 'askHistory').mockResolvedValue(results(true))
    vi.spyOn(historyApi, 'getEpisode').mockImplementation(async id =>
      id === 'episode:cad-2' ? episode(id, 'Second synthetic source') : episode())
    const { container } = render(React.createElement(AskHistoryView, {
      locale: 'en-US', historyRevision: 0, onContinue: vi.fn(),
    }))

    await user.click(screen.getByRole('button', { name: /Explore Work History/ }))
    await user.type(screen.getByRole('searchbox', { name: 'Ask your history' }), 'joint')
    await user.click(screen.getByRole('button', { name: 'Quick local search' }))
    await waitFor(() => expect(container.querySelectorAll('.ch-ask-hit')).toHaveLength(2))
    const hits = container.querySelectorAll('.ch-ask-hit')
    expect(within(hits[0] as HTMLElement).getByRole('button', {
      name: 'Continue work: joint.step',
    })).toBeTruthy()
    expect(within(hits[1] as HTMLElement).getByRole('button', {
      name: 'Inspect source: joint.step',
    })).toBeTruthy()

    await user.click(within(hits[0] as HTMLElement).getByRole('button', {
      name: 'Inspect source: joint.step',
    }))
    await waitFor(() => expect(
      within(hits[0] as HTMLElement).getByRole('region', { name: 'Source for selected result' })
        .textContent,
    ).toContain('episode:cad-1'))
    expect(within(hits[1] as HTMLElement).queryByRole('region')).toBeNull()

    await user.click(within(hits[1] as HTMLElement).getByRole('button', {
      name: 'Inspect source: joint.step',
    }))
    await waitFor(() => expect(
      within(hits[1] as HTMLElement).getByRole('region', { name: 'Source for selected result' })
        .textContent,
    ).toContain('Second synthetic source'))
    expect(within(hits[0] as HTMLElement).queryByRole('region')).toBeNull()
  })

  it('real DOM double click cannot invoke Continue twice before React settles', async () => {
    const user = userEvent.setup()
    vi.spyOn(historyApi, 'askHistory').mockResolvedValue(results())
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode())
    let complete: (() => void) | undefined
    const onContinue = vi.fn().mockImplementation(() => new Promise<void>(resolve => {
      complete = resolve
    }))
    render(React.createElement(AskHistoryView, {
      locale: 'en-US', historyRevision: 0, onContinue,
    }))

    await user.click(screen.getByRole('button', { name: /Explore Work History/ }))
    await user.type(screen.getByRole('searchbox', { name: 'Ask your history' }), 'joint')
    await user.click(screen.getByRole('button', { name: 'Quick local search' }))
    const button = await screen.findByRole('button', { name: 'Continue work: joint.step' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1))
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ id: 'episode:cad-1' }))
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(complete).toBeTypeOf('function')
    complete?.()
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  })

  it('exact AI source requires separate inspect and Continue actions and fails closed on expiry', async () => {
    const user = userEvent.setup()
    const getEpisode = vi.spyOn(historyApi, 'getEpisode')
      .mockResolvedValueOnce(episode())
      .mockRejectedValueOnce(new Error('synthetic source expired'))
    const onContinue = vi.fn()
    render(React.createElement(AskHistoryView, {
      locale: 'en-US', historyRevision: 0,
      onAskWithAi: vi.fn().mockResolvedValue(undefined), onContinue,
    }))

    await user.click(screen.getByRole('button', { name: /Explore Work History/ }))
    expect(screen.queryByRole('button', { name: 'Continue this Episode' })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Source Episode ID' }), 'episode:cad-1')
    await user.click(screen.getByRole('button', { name: 'Inspect Episode source' }))
    const region = await screen.findByRole('region', { name: 'Historical source awaiting confirmation' })
    expect(region.textContent).toContain('episode:cad-1')
    expect(region.textContent).toContain('not proof the file still exists')
    expect(onContinue).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Continue this Episode' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('expired'))
    expect(onContinue).not.toHaveBeenCalled()
    expect(getEpisode).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Continue this Episode' })).toBeNull()
  })

  it('forged/mismatched exact source shows alert and never displays the Continue action', async () => {
    const user = userEvent.setup()
    vi.spyOn(historyApi, 'getEpisode').mockResolvedValue(episode('episode:wrong'))
    const onContinue = vi.fn()
    render(React.createElement(AskHistoryView, {
      locale: 'zh-CN', historyRevision: 0,
      onAskWithAi: vi.fn().mockResolvedValue(undefined), onContinue,
    }))

    await user.click(screen.getByRole('button', { name: /查询工作历史/ }))
    await user.type(screen.getByRole('textbox', { name: '来源 Episode ID' }), 'episode:cad-1')
    await user.click(screen.getByRole('button', { name: '核对 Episode 来源' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未找到有效的 Episode'))
    expect(screen.queryByRole('button', { name: '继续此 Episode' })).toBeNull()
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('keyboard Enter activates a labelled expandable panel and Tab reaches labelled controls', async () => {
    const user = userEvent.setup()
    render(React.createElement(AskHistoryView, {
      locale: 'en-US', historyRevision: 0,
      onAskWithAi: vi.fn().mockResolvedValue(undefined), onContinue: vi.fn(),
    }))
    await user.tab()
    const toggle = screen.getByRole('button', { name: /Explore Work History/ })
    expect(document.activeElement).toBe(toggle)
    await user.keyboard('{Enter}')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Ask your history' }))
    // Disabled submit controls are correctly skipped by Tab until the question is non-empty.
    await user.type(document.activeElement as HTMLInputElement, 'joint')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask DSH AI' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Quick local search' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Source Episode ID' }))
  })


  it('passes automated WCAG semantic checks for an expanded bilingual search panel', async () => {
    for (const locale of ['en-US', 'zh-CN']) {
      const user = userEvent.setup()
      const { container } = render(React.createElement(AskHistoryView, {
        locale, historyRevision: 0,
        onAskWithAi: vi.fn().mockResolvedValue(undefined), onContinue: vi.fn(),
      }))
      await user.click(screen.getByRole('button', {
        name: locale === 'zh-CN' ? /查询工作历史/ : /Explore Work History/,
      }))
      // jsdom has no canvas renderer; axe color-contrast needs a real browser.
      const report = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        rules: { 'color-contrast': { enabled: false } },
      })
      expect(report.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
      cleanup()
    }
  })


  it('keeps narrow-screen wrapping and width guards (static CSS regression; not geometry)', () => {
    const mobileRule = ASK_HISTORY_STYLES.slice(
      ASK_HISTORY_STYLES.indexOf('@media(max-width:560px)'),
    )
    expect(mobileRule).toContain('@media(max-width:560px)')
    expect(mobileRule).toContain('.ch-ask-form>.ch-input{flex:1 1 100%;width:100%;min-width:0}')
    expect(mobileRule).toContain('.ch-ask-form>.ch-button{max-width:100%;width:100%')
    expect(mobileRule).toContain('.ch-ask-hit>.ch-button{margin-left:0;max-width:100%')
    expect(mobileRule).toContain('.ch-ask-exact-preview>.ch-button{width:100%;max-width:100%')
    expect(ASK_HISTORY_STYLES).toContain('.ch-ask-hit{')
    expect(ASK_HISTORY_STYLES).toContain('overflow-wrap:anywhere')
    expect(ASK_HISTORY_STYLES).toContain('.ch-ask-hit>.ch-text-action{margin-top:7px;min-height:28px}')
  })

  it('stale source response cannot replace a later source selection', async () => {
    const user = userEvent.setup()
    vi.spyOn(historyApi, 'askHistory').mockResolvedValue(results(true))
    let finishFirst: ((value: EpisodeDetail) => void) | undefined
    vi.spyOn(historyApi, 'getEpisode').mockImplementation(id =>
      id === 'episode:cad-1'
        ? new Promise<EpisodeDetail>(resolve => { finishFirst = resolve })
        : Promise.resolve(episode('episode:cad-2', 'Latest selected evidence')))
    const { container } = render(React.createElement(AskHistoryView, {
      locale: 'en-US', historyRevision: 0,
    }))
    await user.click(screen.getByRole('button', { name: /Explore Work History/ }))
    await user.type(screen.getByRole('searchbox', { name: 'Ask your history' }), 'joint')
    await user.click(screen.getByRole('button', { name: 'Quick local search' }))
    await waitFor(() => expect(container.querySelectorAll('.ch-ask-hit')).toHaveLength(2))
    const hits = container.querySelectorAll('.ch-ask-hit')
    fireEvent.click(within(hits[0] as HTMLElement).getByRole('button', {
      name: 'Inspect source: joint.step',
    }))
    fireEvent.click(within(hits[1] as HTMLElement).getByRole('button', {
      name: 'Inspect source: joint.step',
    }))
    await waitFor(() => expect(
      within(hits[1] as HTMLElement).getByRole('region', { name: 'Source for selected result' })
        .textContent,
    ).toContain('Latest selected evidence'))
    finishFirst?.(episode())
    await waitFor(() => expect(
      within(hits[1] as HTMLElement).getByRole('region', { name: 'Source for selected result' })
        .textContent,
    ).toContain('Latest selected evidence'))
    expect(within(hits[0] as HTMLElement).queryByRole('region')).toBeNull()
  })
})
