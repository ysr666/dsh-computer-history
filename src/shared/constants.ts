export const PROTOCOL_VERSION = 1 as const
export const OBSERVATION_RETENTION_MS = 24 * 60 * 60 * 1000
export const EPISODE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const DETOUR_GRACE_MS = 90_000
export const IDLE_BOUNDARY_MS = 480_000
export const URL_ATTACH_WINDOW_MS = 90_000
export const MAX_PROTOCOL_LINE_BYTES = 64 * 1024
export const MAX_SUMMARY_BYTES = 1024

export const PHASE1_SUPPORTED_BUNDLE_IDS = [
  'com.microsoft.VSCode',
  'com.todesktop.230313mzl4w4u92',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.apple.Preview',
  'com.apple.finder',
] as const
