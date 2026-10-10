export interface UpgradePreflightResult {
  mode: 'read-only'
  profile: string
  cli: {
    version: string | null
    compatibility: 'tested' | 'incompatible' | 'unverified'
    verifiedVersions: string[]
  }
  plugin: {
    installedVersion: string | null
    dependencyKind: 'local-file-or-link' | 'registry-or-remote' | 'none'
    bundleEnabledInManifest: boolean
    otherBundleCount: number
  }
  historyFiles: {
    database: { present: boolean; sizeBytes: number | null }
    writeAheadLog: { present: boolean; sizeBytes: number | null }
    sharedMemory: { present: boolean; sizeBytes: number | null }
    captureOwnerLock: { present: boolean; sizeBytes: number | null }
  }
  readiness: 'requires-separate-approval'
  blockers: string[]
  cautions: string[]
  nextSteps: string[]
}
export function inspectUpgradeEnvironment(args: {
  dshHome: string
  profile?: string
  dshVersion?: string | null
}): UpgradePreflightResult
