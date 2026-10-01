import { describe, expect, it } from 'vitest'
import { detectResumeIntent } from '../../src/host/resume/index.js'

describe('resume intent', () => {
  it.each([
    ['继续刚才的', true],
    ['接着做', true],
    ['resume last work', true],
    ['continue what I was doing', true],
    ['刚才那个继续一下', true],
    ['今天天气怎么样', false],
    ['解释一下 provider.ts', false],
  ])('classifies %s', (query, expected) => {
    expect(detectResumeIntent(query).isResume).toBe(expected)
  })

  it('detects external surfaces without model semantics', () => {
    expect(detectResumeIntent('继续我刚才在终端里的那个')).toMatchObject({
      isResume: true,
      externalCue: true,
      surface: 'terminal',
    })
    expect(detectResumeIntent('继续刚才 VS Code 里的')).toMatchObject({
      isResume: true,
      externalCue: true,
      surface: 'editor',
    })
  })
})
