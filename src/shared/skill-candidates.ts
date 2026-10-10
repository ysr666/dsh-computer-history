/** Advisory repeat-pattern suggestions, never executable Skill specifications. */
export type SkillCandidateKind =
  | 'repeated-verification'
  | 'save-and-verification'
  | 'repeated-file-changes'

export interface SkillCandidate {
  readonly id: string
  readonly kind: SkillCandidateKind
  /** Observations describe co-occurrence, NOT a known ordered procedure. */
  readonly title: string
  readonly observation: string
  readonly episodeCount: number
  readonly distinctDayCount: number
  readonly firstObservedAtMs: number
  readonly lastObservedAtMs: number
  readonly evidenceEpisodeIds: readonly string[]
  readonly evidenceTruncated: boolean
  readonly observedKinds: readonly string[]
  /** Essential unknowns; never silently become generated steps or commands. */
  readonly missingEvidence: readonly string[]
  readonly readiness: 'needs-user-design'
}

export interface SkillCandidateReport {
  readonly projectMemoryId: string
  readonly candidates: readonly SkillCandidate[]
  readonly scannedEpisodes: number
  readonly scanTruncated: boolean
  readonly conclusion: 'candidates-found' | 'insufficient-evidence'
  readonly privacy: {
    readonly userConfirmedNotes: 'not-read'
    readonly fileBodies: 'not-read'
    readonly autoCreateOrInstall: false
  }
  readonly caveat: string
}
