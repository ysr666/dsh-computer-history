import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Record<string, unknown>
const en = JSON.parse(
  readFileSync(new URL('../package.nls.json', import.meta.url), 'utf8'),
) as Record<string, string>
const zh = JSON.parse(
  readFileSync(new URL('../package.nls.zh-cn.json', import.meta.url), 'utf8'),
) as Record<string, string>

describe('VS Code Companion product metadata', () => {
  it('keeps English and Chinese NLS keys aligned', () => {
    expect(Object.keys(zh).toSorted()).toEqual(Object.keys(en).toSorted())
    expect(pkg.displayName).toBe('%displayName%')
    expect(pkg.description).toBe('%description%')
  })

  it('keeps the metadata-only privacy promise visible in both languages', () => {
    expect(en.description).toContain('file contents are never read')
    expect(zh.description).toContain('不会读取文件正文')
    expect(en.untrustedWorkspaceDescription).toContain('never reads file contents')
    expect(zh.untrustedWorkspaceDescription).toContain('不会读取文件正文')
  })
})
