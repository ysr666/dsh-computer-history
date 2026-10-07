import { describe, expect, it } from 'vitest'
import {
  appFallbackMark,
  appIconKind,
} from '../../src/client/app-icon.js'

describe('application icon identity', () => {
  it('uses one VS Code icon across the three measured platform identities', () => {
    expect(appIconKind('com.microsoft.VSCode', 'VS Code')).toBe('vscode')
    expect(appIconKind('Code.exe', 'VS Code')).toBe('vscode')
    expect(appIconKind('com.microsoft.VSCode.desktop', 'VS Code')).toBe('vscode')
  })

  it('uses one file-manager icon across Finder, Explorer, and Nautilus', () => {
    expect(appIconKind('com.apple.finder', 'Finder')).toBe('files')
    expect(appIconKind('explorer.exe', 'File Explorer')).toBe('files')
    expect(appIconKind('org.gnome.Nautilus.desktop', 'Nautilus')).toBe('files')
  })

  it('uses one terminal icon across platform-specific terminal identities', () => {
    expect(appIconKind('com.apple.Terminal', 'Terminal')).toBe('terminal')
    expect(appIconKind('WindowsTerminal.exe', 'Terminal')).toBe('terminal')
    expect(appIconKind('org.gnome.Terminal.desktop', 'Terminal')).toBe('terminal')
  })

  it('falls back to a compact mark instead of disappearing for an unknown app', () => {
    expect(appIconKind('dev.example.Unknown', 'Example Studio')).toBe('generic')
    expect(appFallbackMark('Example Studio')).toBe('ES')
    expect(appFallbackMark('')).toBe('•')
  })

  it('can use the reader-facing label when a bundle id is unavailable', () => {
    expect(appIconKind(undefined, 'Google Chrome')).toBe('chrome')
    expect(appIconKind(undefined, 'ChatGPT')).toBe('chatgpt')
  })
})
