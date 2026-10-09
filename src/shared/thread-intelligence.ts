/**
 * Ephemeral *hints*, never additions to a verified Work Thread.
 * Strong shared-file evidence and temporal neighbors are deliberately distinct.
 */
export interface RelatedActivity {
  readonly episodeId: string
  readonly anchorEpisodeId: string
  readonly kind: 'exact-resource' | 'nearby-unassigned'
  readonly attribution: 'resource-linked' | 'unattributed'
  readonly observedAtMs: number
  readonly label: string
  readonly appBundleIds: readonly string[]
  readonly sourceEvidence: 'observation-backed' | 'episode-compacted'
  /** Exact canonical URI is included only when both Episodes cite it. */
  readonly sharedResourceUri?: string
}

export interface ThreadActivityLinks {
  readonly projectMemoryId: string
  readonly links: readonly RelatedActivity[]
  readonly scannedEpisodes: number
  readonly scanTruncated: boolean
  readonly caveat: string
}
