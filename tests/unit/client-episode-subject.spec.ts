import { describe, expect, it } from 'vitest'
import { episodeApp, episodeSubject, friendlyAppName, surfaceTitle } from '../../src/client/episode-subject.js'
import { en, type HistoryTranslate } from '../../src/client/locale.js'
import type { EpisodeSummary } from '../../src/shared/index.js'

/**
 * What the panel calls an episode, which is what the user reads.
 *
 * Measured on the Windows machine: `/recent` carried `resources: []` on every row, so the subject fell all the
 * way through to the bare application name and the panel said `Notepad` for every Notepad window of the day -
 * while `observations.window_title` held `无标题 - Notepad` and `47209 - 文件资源管理器`. The surface title is
 * part of the episode summary now, and these are the four steps of the fallback chain in order.
 */
/** The panel's translator, without the host: the same shape tests/unit/client-locale.spec.ts uses. */
const t = ((key: keyof typeof en) => en[key]) as HistoryTranslate

function episode(overrides: Partial<EpisodeSummary> & { surfaces: EpisodeSummary['surfaces'] }): EpisodeSummary {
  return {
    id: 'episode-1' as EpisodeSummary['id'],
    startedAtMs: 0,
    endedAtMs: 1,
    startReason: 'first-observation',
    endReason: 'timeout',
    summaryKind: 'deterministic',
    summary: 'Recent computer activity.',
    resources: [],
    confidence: 0.4,
    state: 'closed',
    observationIds: [],
    ...overrides,
  } as EpisodeSummary
}

describe('the episode subject', () => {
  it('does not expose synthetic or JetBrains bundle tails as app names', () => {
    expect(friendlyAppName('companion.browser')).toBe('Browser')
    expect(friendlyAppName('com.jetbrains.intellij.ce')).toBe('IntelliJ IDEA')
    expect(friendlyAppName('com.jetbrains.pycharm.ce')).toBe('PyCharm')
    expect(friendlyAppName('com.google.android.studio')).toBe('Android Studio')
    expect(friendlyAppName('com.googlecode.iterm2')).toBe('iTerm2')
    expect(friendlyAppName('com.kingsoft.wpsoffice.mac', 'wpsoffice')).toBe('WPS Office')
    expect(friendlyAppName('org.example.Custom', 'My Custom App')).toBe('My Custom App')
  })
  it('prefers a workspace, then a resource, then the surface title, then the app', () => {
    const surfaces = [{ bundleId: 'Notepad.exe', surfaceKind: 'editor' as const, title: '无标题 - Notepad', firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }]

    // No workspace, no resource: this is the Windows shape, and the title is what makes it readable.
    expect(episodeSubject(t, episode({ surfaces }))).toBe('无标题 - Notepad')

    // A resource still wins over the window title - the file is the more specific answer.
    expect(episodeSubject(t, episode({
      surfaces,
      resources: [{ kind: 'file', canonicalUri: 'file:///notes.txt', displayLabel: 'notes.txt', firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }],
      lastStrongResource: { kind: 'file', canonicalUri: 'file:///notes.txt', displayLabel: 'notes.txt' },
    }))).toBe('notes.txt')

    // And a workspace wins over both.
    expect(episodeSubject(t, episode({ surfaces, workspace: { id: 'alpha', root: '/alpha', title: 'alpha' } }))).toBe('alpha')
  })

  it('falls back to the application when there is no title to show', () => {
    const surfaces = [{ bundleId: 'Notepad.exe', surfaceKind: 'editor' as const, firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }]
    expect(surfaceTitle(episode({ surfaces }))).toBeUndefined()
    expect(episodeSubject(t, episode({ surfaces }))).toBe('Notepad')
  })

  it('names a Windows executable and a .desktop id by their stem, not their extension', () => {
    // Measured: the tail rule below turned both into a file extension, so the panel named every Windows
    // application `exe` and every Linux application `desktop`.
    expect(episodeApp(episode({ surfaces: [{ bundleId: 'Notepad.exe', surfaceKind: 'editor', firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }] }))).toBe('Notepad')
    expect(episodeApp(episode({ surfaces: [{ bundleId: 'explorer.exe', surfaceKind: 'window', firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }] }))).toBe('explorer')
    expect(episodeApp(episode({ surfaces: [{ bundleId: 'org.gnome.Terminal.desktop', surfaceKind: 'terminal', firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }] }))).toBe('Terminal')
    expect(episodeApp(episode({ surfaces: [{ bundleId: 'org.gnome.Nautilus.desktop', surfaceKind: 'window', firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }] }))).toBe('Nautilus')
    // A macOS bundle identifier keeps the existing tail rule.
    expect(episodeApp(episode({ surfaces: [{ bundleId: 'com.microsoft.VSCode', surfaceKind: 'editor', firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }] }))).toBe('VS Code')
  })

  it('never takes a title from an adapter that suppresses them', () => {
    // A terminal's title carries the working directory, so ingestion drops it and the surface has none.
    const surfaces = [{ bundleId: 'WindowsTerminal.exe', surfaceKind: 'terminal' as const, firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }]
    expect(surfaceTitle(episode({ surfaces }))).toBeUndefined()
    // A macOS Terminal episode keeps the shape it had: the session, not a title.
    expect(episodeSubject(t, episode({ surfaces: [{ bundleId: 'com.apple.Terminal', surfaceKind: 'terminal' as const, firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }] })))
      .toBe(t('terminalSession'))
  })

  it('ignores a blank title rather than showing whitespace', () => {
    const surfaces = [{ bundleId: 'Notepad.exe', surfaceKind: 'editor' as const, title: '   ', firstSeenAtMs: 0, lastSeenAtMs: 1, observationCount: 1 }]
    expect(surfaceTitle(episode({ surfaces }))).toBeUndefined()
    expect(episodeApp(episode({ surfaces }))).toBe('Notepad')
  })
})
