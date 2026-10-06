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

type SidebarPanelIconOwnerProps = _sidebarClientTypes.SidebarPanelIconOwnerProps

const PANEL_ID = 'computer-history' as MainPanelId

function HistoryIcon({ size }: SidebarPanelIconOwnerProps): React.ReactElement {
  // The platform tells the icon what size it wants - `SidebarPanelIconOwnerProps = { size, active }` - so this
  // takes it instead of guessing. Guessing is what produced the two wrong versions: the row asked for its own
  // square edge and this hardcoded 20, then 18, and each time it read too large or too small against the shipped
  // icons beside it.
  //
  // The frame is cropped to the drawing and centred on its *ink*, not on the artwork's coordinates: with strokes
  // included the ink spans x 4.25..21.30 and y 4.00..19.00, so its centre is (12.78, 11.50) while `2 1 22 22`
  // centred on (13, 12) - which left the glyph about 0.2px high and left of the row's centre, and it already reads
  // left-heavy because the ring and hands carry more mass than the three dots. The frame keeps a margin because a
  // stroke is painted outside the path it belongs to: `4.4 3 17.6 17.6` clipped the left of that stroke.
  return React.createElement(
    'svg',
    {
      'aria-hidden': true,
      viewBox: '1.78 0.5 22 22',
      width: size,
      height: size,
      fill: 'none',
    },
    React.createElement('path', {
      d: 'M5.2 18.4A8.3 8.3 0 1 1 18.3 6.4',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
    }),
    React.createElement('circle', { cx: 18.25, cy: 6.35, r: 1.35, fill: 'currentColor' }),
    React.createElement('circle', { cx: 20.15, cy: 12.05, r: 1.08, fill: 'currentColor' }),
    React.createElement('circle', { cx: 18.35, cy: 17.65, r: 0.9, fill: 'currentColor' }),
    React.createElement('path', {
      d: 'M9.1 17.1A5.4 5.4 0 1 1 15.9 16',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
    }),
    React.createElement('path', {
      d: 'M12 11.8V8.8M12 11.8l2.6 1.8',
      stroke: 'currentColor',
      strokeWidth: 1.35,
      strokeLinecap: 'round',
    }),
  )
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
