import { FOUNDATION_STYLES } from './styles/foundation.js'
import { TIMELINE_STYLES } from './styles/timeline.js'
import { CONTINUITY_STYLES } from './styles/continuity.js'
import { SETTINGS_STYLES } from './styles/settings.js'
import { RESPONSIVE_STYLES } from './styles/responsive.js'

// DSH owns one style tag, installed and disposed from a single point.
const CSS = [
  FOUNDATION_STYLES,
  TIMELINE_STYLES,
  CONTINUITY_STYLES,
  SETTINGS_STYLES,
  RESPONSIVE_STYLES,
].join('\n')

let stylesInstalled = false

export function installHistoryStyles(): () => void {
  if (stylesInstalled || typeof document === 'undefined') return () => {}
  stylesInstalled = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-computer-history'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
    stylesInstalled = false
  }
}
