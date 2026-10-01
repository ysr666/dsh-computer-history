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
