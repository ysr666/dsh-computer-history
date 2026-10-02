/**
 * What the product should say about itself.
 *
 * An empty timeline has four possible meanings and they are not alike: nothing
 * happened, the collector is not running, macOS never granted Accessibility, or the
 * policy allows nothing so nothing can ever be stored. The panel shows this sentence
 * above everything else, and it is a pure function here so it can be tested rather
 * than discovered by a user.
 */
export interface HealthInput {
  readonly capture:
    | 'running'
    | 'paused'
    | 'stopped'
    | 'degraded'
    | 'permission-required'
  readonly accessibilityTrusted: boolean
  readonly allowRules: number
  readonly observationCount: number
  readonly newestObservationAtMs: number | undefined
  readonly nowMs: number
}

export type HealthCode =
  | 'paused'
  | 'stopped'
  | 'degraded'
  | 'permission'
  | 'nothing-allowed'
  | 'idle'
  | 'recording'

export interface HealthLine {
  /** `blocked` means nothing will ever be stored until the user acts. */
  readonly level: 'recording' | 'idle' | 'blocked'
  /** Which state it is, so the panel can say it in the interface's language. */
  readonly code: HealthCode
  readonly text: string
}

function minutes(ms: number): number {
  return Math.max(0, Math.round(ms / 60_000))
}

export function describeHealth(input: HealthInput): HealthLine {
  if (input.capture === 'paused') {
    return {
      level: 'blocked',
      code: 'paused',
      text: 'Collection is paused, so nothing new is being recorded. Resume it to '
        + 'start again.',
    }
  }
  if (input.capture === 'stopped' || input.capture === 'degraded') {
    return {
      level: 'blocked',
      code: input.capture === 'stopped' ? 'stopped' : 'degraded',
      text: input.capture === 'stopped'
        ? 'Collection is stopped, so nothing new is being recorded.'
        : 'Collection is not running normally, so nothing new may be recorded.',
    }
  }
  if (input.capture === 'permission-required' || !input.accessibilityTrusted) {
    return {
      level: 'blocked',
      code: 'permission',
      text: 'macOS has not granted Accessibility to the collector, so nothing can be '
        + 'recorded. Grant it in System Settings, Privacy & Security, Accessibility.',
    }
  }
  if (input.allowRules === 0) {
    return {
      level: 'blocked',
      code: 'nothing-allowed',
      text: 'Nothing is allowed yet, so nothing will be recorded. Add an application '
        + 'below to start.',
    }
  }
  if (input.observationCount === 0) {
    return {
      level: 'idle',
      code: 'idle',
      text: 'Collecting, and ready. Nothing has been recorded yet.',
    }
  }
  const age = input.newestObservationAtMs === undefined
    ? undefined
    : minutes(input.nowMs - input.newestObservationAtMs)
  return {
    level: 'recording',
    code: 'recording',
    text: age === undefined
      ? `Recording: ${input.observationCount} observations.`
      : `Recording: ${input.observationCount} observations, newest ${age} minute(s) ago.`,
  }
}
