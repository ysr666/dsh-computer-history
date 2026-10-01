export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type ObservationId = Brand<number, 'ObservationId'>
export type ResourceId = Brand<number, 'ResourceId'>
export type EpisodeId = Brand<string, 'EpisodeId'>
export type PolicyRuleId = Brand<string, 'PolicyRuleId'>
export type CollectorSessionId = Brand<string, 'CollectorSessionId'>

export const EpisodeId = (value: string): EpisodeId => value as EpisodeId
export const PolicyRuleId = (value: string): PolicyRuleId => value as PolicyRuleId
export const CollectorSessionId = (value: string): CollectorSessionId => value as CollectorSessionId
