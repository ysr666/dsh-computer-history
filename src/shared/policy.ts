import type { PolicyRuleId } from './ids.js'

export type PolicyMode = 'include-only' | 'exclude'
export type PolicyDimension = 'app' | 'resource'
export type PolicyAction = 'allow' | 'deny' | 'protect'
export type PolicyMatcher = 'exact' | 'prefix' | 'glob'

export interface PolicyRule {
  readonly id: PolicyRuleId
  readonly dimension: PolicyDimension
  readonly action: PolicyAction
  readonly matcher: PolicyMatcher
  readonly pattern: string
  readonly builtIn: boolean
  readonly createdAtMs: number
  readonly updatedAtMs: number
}

export interface PolicySnapshot {
  readonly revision: number
  readonly mode: PolicyMode
  readonly rules: readonly PolicyRule[]
  readonly updatedAtMs: number
}

function globMatches(pattern: string, value: string): boolean {
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let starValueIndex = -1

  while (valueIndex < value.length) {
    if (
      patternIndex < pattern.length
      && pattern[patternIndex] === value[valueIndex]
    ) {
      patternIndex += 1
      valueIndex += 1
    } else if (
      patternIndex < pattern.length
      && pattern[patternIndex] === '*'
    ) {
      starIndex = patternIndex++
      starValueIndex = valueIndex
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1
      valueIndex = ++starValueIndex
    } else {
      return false
    }
  }

  while (
    patternIndex < pattern.length
    && pattern[patternIndex] === '*'
  ) {
    patternIndex += 1
  }
  return patternIndex === pattern.length
}

export function policyRuleMatches(
  rule: Pick<PolicyRule, 'matcher' | 'pattern'>,
  value: string,
): boolean {
  if (rule.matcher === 'exact') {
    return value === rule.pattern
  }
  if (rule.matcher === 'prefix') {
    return value.startsWith(rule.pattern)
  }
  return globMatches(rule.pattern, value)
}
