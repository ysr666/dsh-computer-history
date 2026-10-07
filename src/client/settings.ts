import type { Context } from '@deepseek-ai/cordis'
import { HISTORY_LOCALE_NS } from './locale.js'
import { createSettingsPage } from './settings-view.js'
import type { HistoryControlStore } from './store.js'
import type { ComputerHistoryPluginNavigation } from './plugin-navigation.js'

export function applySettings(
  ctx: Context,
  store: HistoryControlStore,
  getPluginNavigation?: () => ComputerHistoryPluginNavigation | undefined,
): void {
  const SettingsPage = createSettingsPage({
    store,
    ...(getPluginNavigation === undefined ? {} : { getPluginNavigation }),
  })
  const t = ctx.locale.bind(HISTORY_LOCALE_NS)
  ctx.effect(
    () => ctx.slots.inject('settings.section', function* () {
      yield ctx.slots.register(
        {
          name: 'settings.section',
          id: 'computer-history',
          order: 40,
          label: () => t('title'),
          locale: HISTORY_LOCALE_NS,
        },
        SettingsPage,
      )
    }),
    'computer-history: settings section',
  )
}
