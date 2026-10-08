import type { EpisodeId } from './ids.js'

export const COMPUTER_HISTORY_REFERENCE_SCHEME = 'dsh-computer-history:episode/' as const
export const COMPUTER_HISTORY_REFERENCE_LABEL = 'Computer History' as const
export const COMPUTER_HISTORY_VISIBLE_MENTION = '@"Computer History"' as const

export interface BindContinuationSessionRequest {
  readonly sessionId: string
  readonly episodeId: EpisodeId
}

export function computerHistoryReferenceUri(episodeId: EpisodeId | string): string {
  return COMPUTER_HISTORY_REFERENCE_SCHEME + encodeURIComponent(String(episodeId))
}

export function episodeIdFromComputerHistoryReference(ref: string): EpisodeId | undefined {
  if (!ref.startsWith(COMPUTER_HISTORY_REFERENCE_SCHEME)) return undefined
  const encoded = ref.slice(COMPUTER_HISTORY_REFERENCE_SCHEME.length)
  if (encoded === '' || encoded.length > 2_048) return undefined
  try {
    const value = decodeURIComponent(encoded)
    return value === '' || value.length > 1_000 ? undefined : value as EpisodeId
  } catch {
    return undefined
  }
}

/**
 * Submitted/pasted text is intentionally identifier-free. The exact Episode
 * binding lives in the local Host store under the DSH Session id.
 */
export function formatComputerHistoryMention(ref: string): string {
  if (episodeIdFromComputerHistoryReference(ref) === undefined) {
    throw new Error('invalid Computer History reference')
  }
  return COMPUTER_HISTORY_VISIBLE_MENTION
}

const VISIBLE_MENTION_RE = /(^|\s)@"Computer History"(?=\s|$|[.,;:!?，。；：！？])/gu

export function hasComputerHistoryMention(text: string): boolean {
  VISIBLE_MENTION_RE.lastIndex = 0
  return VISIBLE_MENTION_RE.test(text)
}

export function stripComputerHistoryMention(text: string): string {
  VISIBLE_MENTION_RE.lastIndex = 0
  return text
    .replace(VISIBLE_MENTION_RE, (_match, prefix: string) => prefix)
    .replace(/[ \t]{2,}/gu, ' ')
    .trim()
}
