import React from 'react'

export interface HistoryGlyphProps {
  readonly size: number
  readonly className?: string
}

/** Computer History product mark shared by the sidebar and first-run surface. */
export function HistoryGlyph({
  size,
  className,
}: HistoryGlyphProps): React.ReactElement {
  return React.createElement(
    'svg',
    {
      'aria-hidden': true,
      viewBox: '0.12 -0.04 22 22',
      width: size,
      height: size,
      fill: 'none',
      ...(className ? { className } : {}),
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
