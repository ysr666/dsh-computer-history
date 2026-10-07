import React from 'react'

export type AppIconKind =
  | 'terminal'
  | 'vscode'
  | 'xcode'
  | 'files'
  | 'preview'
  | 'notes'
  | 'safari'
  | 'chrome'
  | 'edge'
  | 'chatgpt'
  | 'generic'

const BUNDLE_ICON_KIND: Readonly<Record<string, AppIconKind>> = {
  'com.apple.Terminal': 'terminal',
  'com.googlecode.iterm2': 'terminal',
  'WindowsTerminal.exe': 'terminal',
  'org.gnome.Terminal.desktop': 'terminal',
  'org.kde.konsole.desktop': 'terminal',

  'com.microsoft.VSCode': 'vscode',
  'com.microsoft.VSCodeInsiders': 'vscode',
  'Code.exe': 'vscode',
  'com.microsoft.VSCode.desktop': 'vscode',
  'code.desktop': 'vscode',
  'code-insiders.desktop': 'vscode',

  'com.apple.dt.Xcode': 'xcode',

  'com.apple.finder': 'files',
  'explorer.exe': 'files',
  'org.gnome.Nautilus.desktop': 'files',
  'org.kde.dolphin.desktop': 'files',

  'com.apple.Preview': 'preview',

  'com.apple.Notes': 'notes',
  'Notepad.exe': 'notes',

  'com.apple.Safari': 'safari',

  'com.google.Chrome': 'chrome',
  'chrome.exe': 'chrome',
  'google-chrome.desktop': 'chrome',
  'google-chrome-stable.desktop': 'chrome',

  'com.microsoft.edgemac': 'edge',
  'msedge.exe': 'edge',
  'microsoft-edge.desktop': 'edge',

  'com.openai.chat': 'chatgpt',
}

const LABEL_ICON_KIND: Readonly<Record<string, AppIconKind>> = {
  Terminal: 'terminal',
  iTerm2: 'terminal',
  'VS Code': 'vscode',
  'Visual Studio Code': 'vscode',
  Xcode: 'xcode',
  Finder: 'files',
  Explorer: 'files',
  'File Explorer': 'files',
  Files: 'files',
  Nautilus: 'files',
  Preview: 'preview',
  Notes: 'notes',
  Notepad: 'notes',
  Safari: 'safari',
  'Google Chrome': 'chrome',
  Chrome: 'chrome',
  'Microsoft Edge': 'edge',
  Edge: 'edge',
  ChatGPT: 'chatgpt',
}

export function appIconKind(
  bundleId: string | undefined,
  label: string,
): AppIconKind {
  if (bundleId && BUNDLE_ICON_KIND[bundleId]) return BUNDLE_ICON_KIND[bundleId]!
  return LABEL_ICON_KIND[label] ?? 'generic'
}

export function appFallbackMark(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  const initials = parts.slice(0, 2).map(part => part[0]).join('')
  return (initials || '•').toUpperCase()
}

function svg(...children: React.ReactNode[]): React.ReactElement {
  return React.createElement(
    'svg',
    {
      viewBox: '0 0 24 24',
      focusable: false,
      'aria-hidden': true,
    },
    ...children,
  )
}

function terminalGlyph(): React.ReactElement {
  return svg(
    React.createElement('path', {
      d: 'M5 7.5 9.5 12 5 16.5M11.5 17h7',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

function vscodeGlyph(): React.ReactElement {
  return svg(
    React.createElement('path', {
      d: 'm16.9 3.5-6.4 5-3.8-2.9-3.2 2.8L7.7 12l-4.2 3.6 3.2 2.8 3.8-2.9 6.4 5L21 18.6V5.4l-4.1-1.9Zm0 4.5v8l-5.1-4 5.1-4Z',
      fill: 'currentColor',
    }),
  )
}

function xcodeGlyph(): React.ReactElement {
  return svg(
    React.createElement('path', {
      d: 'M7.2 18.2 15.9 6M14.4 4.6l2.9 2.1M5.1 16.8l3.3 2.4M13.2 8.7 18.8 17M17 17h2.7M5 19h5.3',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

function filesGlyph(): React.ReactElement {
  return svg(
    React.createElement('path', {
      d: 'M12 4v16M8.1 9.1c.6-.8 1.4-1.2 2.3-1.2M13.6 7.9c.9 0 1.7.4 2.3 1.2M8 15.2c1.1 1.1 2.4 1.7 4 1.7s2.9-.6 4-1.7',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.55,
      strokeLinecap: 'round',
    }),
  )
}

function previewGlyph(): React.ReactElement {
  return svg(
    React.createElement('path', {
      d: 'M6 4.5h8.5L18 8v11.5H6zM14.5 4.5V8H18',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinejoin: 'round',
    }),
    React.createElement('circle', {
      cx: 10.2,
      cy: 13.2,
      r: 2.4,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
    }),
    React.createElement('path', {
      d: 'm12 15 2 2',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
    }),
  )
}

function notesGlyph(): React.ReactElement {
  return svg(
    React.createElement('rect', {
      x: 5,
      y: 4,
      width: 14,
      height: 16,
      rx: 2.5,
      fill: 'rgba(255,255,255,.96)',
    }),
    React.createElement('path', {
      d: 'M5 8h14',
      stroke: '#f4c542',
      strokeWidth: 3,
    }),
    React.createElement('path', {
      d: 'M8 12h8M8 15h6',
      stroke: '#7a6d52',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
    }),
  )
}

function safariGlyph(): React.ReactElement {
  return svg(
    React.createElement('circle', {
      cx: 12,
      cy: 12,
      r: 7.5,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.35,
    }),
    React.createElement('path', {
      d: 'm14.8 8.5-1.7 4.7-4.7 2.3 2.1-4.8 4.3-2.2Z',
      fill: '#f05a5a',
      stroke: 'rgba(255,255,255,.85)',
      strokeWidth: 0.8,
      strokeLinejoin: 'round',
    }),
    React.createElement('circle', {
      cx: 12,
      cy: 12,
      r: 1,
      fill: 'currentColor',
    }),
  )
}

function edgeGlyph(): React.ReactElement {
  return svg(
    React.createElement('path', {
      d: 'M18.5 15.8c-1.2 2.1-3.6 3.2-6.3 3.2-4.3 0-7.2-2.7-7.2-6.5 0-4.3 3.3-7.5 7.9-7.5 3.8 0 6.6 2.2 6.6 5.6 0 .7-.1 1.2-.2 1.6H8.1c.3 2 2 3.2 4.6 3.2 1.7 0 3.1-.4 4.2-1.3',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

function chatgptGlyph(): React.ReactElement {
  const circles = [
    [12, 7.2], [16.2, 9.6], [16.2, 14.4],
    [12, 16.8], [7.8, 14.4], [7.8, 9.6],
  ] as const
  return svg(
    ...circles.map(([cx, cy], index) => React.createElement('circle', {
      key: index,
      cx,
      cy,
      r: 3.25,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
    })),
  )
}

export function appIcon(
  bundleId: string | undefined,
  label: string,
): React.ReactElement {
  const kind = appIconKind(bundleId, label)
  let content: React.ReactNode

  switch (kind) {
    case 'terminal':
      content = terminalGlyph()
      break
    case 'vscode':
      content = vscodeGlyph()
      break
    case 'xcode':
      content = xcodeGlyph()
      break
    case 'files':
      content = filesGlyph()
      break
    case 'preview':
      content = previewGlyph()
      break
    case 'notes':
      content = notesGlyph()
      break
    case 'safari':
      content = safariGlyph()
      break
    case 'chrome':
      content = React.createElement('span', { className: 'ch-app-icon-core' })
      break
    case 'edge':
      content = edgeGlyph()
      break
    case 'chatgpt':
      content = chatgptGlyph()
      break
    case 'generic':
      content = appFallbackMark(label)
      break
  }

  return React.createElement(
    'span',
    {
      className: `ch-app-mark ch-app-icon ch-app-icon-${kind}`,
      'aria-hidden': true,
      title: label,
    },
    content,
  )
}
