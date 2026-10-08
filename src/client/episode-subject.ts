import { isGenericContinuationCandidate, type EpisodeSummary, type ResumeHandoff, type SurfaceKind, type TimelineActivity } from '../shared/index.js'
import type { HistoryTranslate } from './locale.js'

/**
 * What an episode is called, with no help from a database or a running host.
 *
 * These three lived inside `panel.ts` until 2026-10-05, when the surface title became part of the summary and
 * the rule needed somewhere to be tested: on a platform with no resource to anchor to (Windows, where
 * `resources` is empty on every row) the subject used to fall back to the bare application name, so the panel
 * said `Notepad` for every Notepad window of the day while the observation had been carrying
 * `无标题 - Notepad` all along.
 *
 * The order is deliberate: a workspace name says more than a file, a file says more than the window it is open
 * in, and the window title says more than the application.
 */
export function friendlyAppName(bundleId: string, discoveredName?: string): string {
  const known: Record<string, string> = {
    'com.apple.Notes': 'Notes',
    'com.apple.Preview': 'Preview',
    'com.apple.Terminal': 'Terminal',
    'com.apple.finder': 'Finder',
    'com.apple.dt.Xcode': 'Xcode',
    'com.apple.Safari': 'Safari',
    'com.google.Chrome': 'Google Chrome',
    'com.microsoft.VSCode': 'VS Code',
    'com.microsoft.edgemac': 'Microsoft Edge',
    'com.microsoft.Word': 'Microsoft Word',
    'com.openai.chat': 'ChatGPT',
    'com.googlecode.iterm2': 'iTerm2',
    'com.kingsoft.wpsoffice.mac': 'WPS Office',
    'md.obsidian': 'Obsidian',
    'companion.browser': 'Browser',
    'com.google.android.studio': 'Android Studio',
    'com.jetbrains.intellij': 'IntelliJ IDEA',
    'com.jetbrains.intellij.ce': 'IntelliJ IDEA',
    'com.jetbrains.pycharm': 'PyCharm',
    'com.jetbrains.pycharm.ce': 'PyCharm',
    'com.jetbrains.goland': 'GoLand',
    'com.jetbrains.webstorm': 'WebStorm',
    'com.jetbrains.clion': 'CLion',
    'com.jetbrains.rustrover': 'RustRover',
    'com.jetbrains.datagrip': 'DataGrip',
  }
  if (known[bundleId]) return known[bundleId]
  if (discoveredName?.trim()) return discoveredName.trim()
  // Two of the three platforms report an identity that is not a reverse-DNS name, and the tail rule below
  // turned both into a file extension: `Notepad.exe` displayed as `exe` and `org.gnome.Terminal.desktop` as
  // `desktop`. Measured on the Linux row, where the panel would have named every application `desktop`.
  // The stem is what the user calls the application, so it is taken before the tail rule runs.
  const executable = /^(.+)\.(?:exe|com|bat)$/i.exec(bundleId)
  if (executable?.[1]) return executable[1]
  const desktop = /^(.+)\.desktop$/.exec(bundleId)
  if (desktop?.[1]) return friendlyAppName(desktop[1])
  const tail = bundleId.split('.').findLast(part => part.length > 0)
  return tail && tail.length <= 28 ? tail.replaceAll('-', ' ') : bundleId
}

/** The application an episode belongs to, as the panel names it. */
export function episodeApp(
  episode: Pick<EpisodeSummary, 'surfaces'> | Pick<TimelineActivity, 'surfaces'>,
): string {
  const first = episode.surfaces[0]?.bundleId
  return first ? friendlyAppName(first) : '—'
}

/**
 * Human-readable anchor for the primary generic Continue candidate.
 * Terminal-only activity deliberately yields no continuation subject.
 */
export function continuationSubject(
  episode: Pick<EpisodeSummary, 'workspace' | 'lastStrongResource' | 'resources' | 'surfaces'>,
): string | undefined {
  if (episodeApp(episode) === 'Terminal') return undefined
  const workspace = episode.workspace?.title?.trim()
  if (workspace) return workspace
  return episode.lastStrongResource?.displayLabel
    ?? episode.resources[0]?.displayLabel
}

/** First recent Episode that is both auditable and useful as a generic Continue target. */
export function pickContinuationEpisode(
  episodes: readonly EpisodeSummary[],
): EpisodeSummary | undefined {
  return episodes.find(episode =>
    isGenericContinuationCandidate(episode)
    && continuationSubject(episode) !== undefined,
  )
}

export function continuationResourceUri(
  episode: Pick<EpisodeSummary, 'lastStrongResource' | 'resources'>,
  handoff?: ResumeHandoff | null,
): string | undefined {
  if (handoff?.status === 'hit' && handoff.lastActiveResource?.canonicalUri) {
    return handoff.lastActiveResource.canonicalUri
  }
  return (episode.lastStrongResource ?? episode.resources[0])?.canonicalUri
}

export function isHomeDirectoryResource(
  resource: { readonly kind: string, readonly canonicalUri: string } | undefined,
): boolean {
  return resource?.kind === 'directory'
    && /^file:\/\/\/Users\/[^/]+\/?$/.test(resource.canonicalUri)
}

/**
 * The title of the surface the episode was mostly about: the first surface summary that carries one.
 *
 * `suppressesWindowTitle` adapters (terminals, whose titles hold a working directory) contribute none, and
 * the value has already been through the ingestion rules by the time it is here.
 */
export function surfaceTitle(
  episode: Pick<EpisodeSummary, 'surfaces'> | Pick<TimelineActivity, 'surfaces'>,
): string | undefined {
  for (const surface of episode.surfaces) {
    const title = (surface as { readonly title?: string }).title?.trim()
    if (title) return title
  }
  return undefined
}

export function episodeSubject(t: HistoryTranslate, episode: EpisodeSummary | TimelineActivity): string {
  const workspaceTitle = episode.workspace?.title?.trim()
  if (episodeApp(episode) === 'Terminal') {
    const rootParts = episode.workspace?.root?.split('/').filter(Boolean) ?? []
    const isHomeWorkspace = rootParts.length === 2
      && rootParts[0] === 'Users'
      && rootParts[1] === workspaceTitle
    const resource = episode.lastStrongResource ?? episode.resources[0]
    if (!workspaceTitle || isHomeWorkspace) {
      return isHomeDirectoryResource(resource)
        ? t('terminalSession')
        : resource?.displayLabel ?? t('terminalSession')
    }
  }
  return workspaceTitle
    ?? episode.lastStrongResource?.displayLabel
    ?? episode.resources[0]?.displayLabel
    ?? surfaceTitle(episode)
    ?? episodeApp(episode)
}

/** Exported for the tests that assert the surface kinds a caller may hand in. */
export type { SurfaceKind }

