import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

export const COMPUTER_HISTORY_PACKAGE = 'dsh-computer-history'
export const COMPUTER_HISTORY_PANEL_ID = 'computer-history' as MainPanelId

export interface ComputerHistoryPluginNavigation {
  open(): void
}

interface DshPluginNavigation {
  openBundle(packageName: string): void
}

export function computerHistoryPluginNavigation(
  ctx: Pick<Context, 'reflect'>,
): ComputerHistoryPluginNavigation | undefined {
  const candidate = ctx.reflect.get('pluginNavigation', true) as
    | Partial<DshPluginNavigation>
    | undefined
  if (!candidate || typeof candidate.openBundle !== 'function') return undefined
  return {
    open: () => { candidate.openBundle?.(COMPUTER_HISTORY_PACKAGE) },
  }
}
