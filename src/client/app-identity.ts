import React from 'react'
import { historyApiPath } from './api-route.js'

export function appMark(label: string): string {
  const known: Record<string, string> = {
    Terminal: '>_',
    'VS Code': 'VS',
    Xcode: 'X',
    Finder: 'F',
    Preview: 'P',
    Notes: 'N',
    Safari: 'S',
    'Google Chrome': 'GC',
    'Microsoft Edge': 'E',
    ChatGPT: '✦',
  }
  if (known[label]) return known[label]
  const parts = label.trim().split(/\s+/).filter(Boolean)
  const initials = parts.slice(0, 2).map(part => part[0]).join('')
  return (initials || '•').toUpperCase()
}

function canRequestSystemIcon(bundleId: string | undefined): bundleId is string {
  if (!bundleId) return false
  if (bundleId === 'companion.browser') return false
  if (/\.(?:exe|com|bat|desktop)$/i.test(bundleId)) return false
  return bundleId.includes('.')
}

export function applicationIconSrc(bundleId: string): string {
  return historyApiPath(`/system/application-icon?bundleId=${encodeURIComponent(bundleId)}`)
}

export function ApplicationIcon({
  app,
  bundleId,
  compact = false,
}: {
  readonly app: string
  readonly bundleId?: string | undefined
  readonly compact?: boolean
}): React.ReactElement {
  return React.createElement(
    'span',
    {
      className: compact ? 'ch-app-mark ch-app-mark-compact' : 'ch-app-mark',
      'aria-hidden': true,
      title: app,
    },
    React.createElement('span', { className: 'ch-app-mark-fallback' }, appMark(app)),
    canRequestSystemIcon(bundleId)
      ? React.createElement('img', {
          className: 'ch-app-mark-image',
          src: applicationIconSrc(bundleId),
          alt: '',
          loading: 'lazy',
          decoding: 'async',
          onError: (event: React.SyntheticEvent<HTMLImageElement>) => {
            event.currentTarget.hidden = true
          },
        })
      : null,
  )
}
