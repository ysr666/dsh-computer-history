// Types for the engine namespace the companion resolves at startup. The implementation stays
// plain ESM JavaScript because the browsers load it directly; this declaration keeps the tests
// honest about what the two engines must both provide.
//
// Only the surface the companion actually uses is declared. A member added here without being
// available on both engines is the failure this file is meant to catch, so it stays narrow.

export interface CompanionTabQuery {
  readonly active: boolean
  readonly windowId?: number
}

export interface CompanionTab {
  readonly url?: string
  readonly title?: string
  readonly incognito?: boolean
  readonly active?: boolean
}

export interface CompanionChangeInfo {
  readonly status?: string
}

export interface CompanionNamespace {
  readonly i18n: {
    getMessage(messageName: string, substitutions?: string | readonly string[]): string
    getUILanguage(): string
  }
  readonly storage: {
    readonly local: {
      get(keys: readonly string[]): Promise<Record<string, unknown>>
      set(values: Record<string, unknown>): Promise<void>
    }
  }
  readonly tabs: {
    query(query: CompanionTabQuery): Promise<CompanionTab[]>
    readonly onActivated: { addListener(listener: (info: { windowId: number }) => void): void }
    readonly onUpdated: {
      addListener(listener: (tabId: number, changeInfo: CompanionChangeInfo, tab: CompanionTab) => void): void
    }
  }
  readonly windows: {
    readonly WINDOW_ID_NONE: number
    readonly onFocusChanged: { addListener(listener: (windowId: number) => void): void }
  }
  readonly runtime: {
    readonly onInstalled: { addListener(listener: () => void): void }
  }
}

/**
 * `browser` when the engine defines it (Gecko), otherwise `chrome` (Chromium).
 *
 * Gecko defines both names and only `browser.*` returns promises there, so the order matters.
 */
export declare const ext: CompanionNamespace
