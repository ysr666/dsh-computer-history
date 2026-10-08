/** Public test-only contract for the npm registry identity verifier. */
export type RegistryResult = {
  state: 'missing' | 'visible' | 'fatal' | 'transient' | 'timeout' | 'mismatch' | 'exact'
  sha1?: string
  detail?: string
  attempt?: number
  remoteSha1?: string
  last?: RegistryResult
}

export type RegistryOptions = {
  packageName: string
  version: string
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  attempts?: number
  delayMs?: number
  sleepImpl?: (ms: number) => Promise<void>
}

export function lookupRegistryIdentity(options: RegistryOptions): Promise<RegistryResult>
export function inspectRegistryIdentity(options: RegistryOptions): Promise<RegistryResult>
export function waitForRegistryIdentity(options: RegistryOptions & {
  expectedSha1: string
  onWait?: (args: { attempt: number; attempts: number; result: RegistryResult }) => void
}): Promise<RegistryResult>
