export interface FirstRunPolicyAudit {
  ok: boolean
  reason?: string
  expectedCount?: number
  actualCount?: number
  inventoryAvailable?: boolean
  missing?: string[]
  unexpected?: string[]
}
export declare function inspectFirstRunPolicy(input: {
  preset: { bundles: readonly string[] } | undefined
  inventory: { available: boolean; applications: readonly { bundleId: string }[] } | undefined
  policy: { mode: string; rules: readonly { dimension: string; action: string; pattern: string }[] } | undefined
}): FirstRunPolicyAudit
