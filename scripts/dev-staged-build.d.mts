/** Development-only build: validate all artifacts before replacing the HMR Client entry. */
export function publishVerifiedBuild(stage: string, destination: string,
  options?: { afterFile?: (path: string) => void | Promise<void> }): Promise<void>
export function stagedBuild(root?: string,
  run?: (command: string, args: string[], env?: Record<string, string | undefined>) => Promise<void>): Promise<void>
