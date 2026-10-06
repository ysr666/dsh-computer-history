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
  // The frame is centred on the drawing's *measured* ink, not on its endpoints. The first attempt used the
  // endpoints plus the stroke half-width, which misses that a large-arc sweeps well past its endpoints: sampled
  // against the spec's endpoint-to-centre conversion, the ink actually spans x 1.92..21.23 and y 2.57..19.35, so
  // its centre is (11.57, 10.96) while the frame sat on (12.78, 11.50) - about 1.1px left of centre at a 20px
  // icon, which is what the owner kept seeing. The frame keeps a margin because a stroke is painted outside the
  // path it belongs to: `4.4 3 17.6 17.6` clipped the left of that stroke.
  //
  // The frame then sits 0.45 units left of that measured centre on purpose. The bbox is even, but the drawing is
  // not: the ring and the hands carry more mass than the three dots on the right, so a centred bbox still reads
  // left-heavy - the owner saw it twice, and agreed to the deliberate nudge. 0.45 units is ~0.4px at a 20px icon
  // and scales with whatever size the row asks for, so it stays a nudge at every size.
  return React.createElement(
    'svg',
    {
      'aria-hidden': true,
      viewBox: '0.12 -0.04 22 22',
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
