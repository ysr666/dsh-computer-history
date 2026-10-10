/** Historical cadence is evidence for proposing a reminder, not a schedule. */
export type AutomationCandidateCadence = 'daily-pattern' | 'weekly-pattern'

export interface AutomationCandidate {
  readonly id: string
  /** A review reminder only. Never imply unattended command execution. */
  readonly kind: 'verification-review'
  readonly observedActivity: 'test' | 'build'
  readonly cadence: AutomationCandidateCadence
  readonly observedOnDaysUtc: readonly string[]
  readonly lastObservedAtMs: number
  readonly distinctDayCount: number
  readonly sourceEpisodeIds: readonly string[]
  readonly evidenceTruncated: boolean
  readonly observation: string
  readonly missingDecisions: readonly string[]
  readonly readiness: 'requires-user-review'
  readonly permittedAction: 'review-reminder-only'
}

export interface AutomationCandidateReport {
  readonly projectMemoryId: string
  readonly candidates: readonly AutomationCandidate[]
  readonly scannedEpisodes: number
  readonly scanTruncated: boolean
  readonly conclusion: 'candidate-found' | 'no-reliable-cadence'
  readonly privacy: {
    readonly confirmedNotes: 'not-read'
    readonly fileBodies: 'not-read'
    readonly backgroundMonitoring: false
    readonly jobsCreated: false
    readonly executableCommands: 'not-collected-or-run'
  }
  readonly caveat: string
}
