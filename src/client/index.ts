import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-client-locale'
import '@deepseek-ai/dsh-client-ui-renderer'
import '@deepseek-ai/dsh-client-ui-sidebar'
import '@deepseek-ai/dsh-client-ui-slots'
import '@deepseek-ai/dsh-client-ui-settings'
import type * as _localeClientTypes from '@deepseek-ai/dsh-client-locale/client'
import type * as _settingsClientTypes from '@deepseek-ai/dsh-client-ui-settings/client'
import type * as _rendererClientTypes from '@deepseek-ai/dsh-client-ui-renderer/client'
import type * as _sidebarClientTypes from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import React from 'react'
import {
  en,
  HISTORY_LOCALE_NS,
  zh,
} from './locale.js'
import { createHistoryPage } from './panel.js'
import { applySettings } from './settings.js'
import { installHistoryStyles } from './styles.js'
import { createHistoryControlStore } from './store.js'

const PANEL_ID = 'computer-history' as MainPanelId

function HistoryIcon(): React.ReactElement {
  return React.createElement('span', { 'aria-hidden': true }, '◷')
}

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(HISTORY_LOCALE_NS, { zh, en }),
    'computer-history: locale',
  )
  const t = ctx.locale.bind(HISTORY_LOCALE_NS)
  const store = createHistoryControlStore()
  const HistoryPage = createHistoryPage({
    getActiveLocale: () => String(ctx.locale.getLocale().active),
    store,
  })

  ctx.effect(installHistoryStyles, 'computer-history: client styles')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: HISTORY_LOCALE_NS,
  }, HistoryPage))
  applySettings(ctx, store)
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: () => t('title'),
  }, HistoryIcon))
}
