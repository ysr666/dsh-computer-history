import {
  MAX_SUMMARY_BYTES,
  type EpisodeResourceSummary,
  type EpisodeSurfaceSummary,
} from '../../shared/index.js'

function truncateUtf8(
  value: string,
  maxBytes: number,
): string {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= maxBytes) return value

  let end = value.length
  while (
    end > 0
    && new TextEncoder().encode(value.slice(0, end) + '…').byteLength
      > maxBytes
  ) {
    end -= 1
  }

  return value.slice(0, end) + '…'
}

export function renderDeterministicSummary(input: {
  readonly workspaceTitle?: string
  readonly resources: readonly EpisodeResourceSummary[]
  readonly surfaces: readonly EpisodeSurfaceSummary[]
}): string {
  const heading = input.workspaceTitle
    ? `Worked in ${input.workspaceTitle}.`
    : 'Recent computer activity.'

  const observed = input.resources.slice(0, 8).map((resource) => {
    const label = resource.displayLabel ?? resource.canonicalUri
    return `- ${label}`
  })

  const surfaceNames = [
    ...new Set(input.surfaces.map((surface) => surface.bundleId)),
  ].slice(0, 8)

  const lines = [heading]

  if (observed.length > 0) {
    lines.push('', 'Observed resources:', ...observed)
  }

  if (surfaceNames.length > 0) {
    lines.push('', `Applications: ${surfaceNames.join(', ')}`)
  }

  return truncateUtf8(lines.join('\n'), MAX_SUMMARY_BYTES)
}
