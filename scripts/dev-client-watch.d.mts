/** Serial, debounced rebuild scheduler. It does not perform browser HMR. */
export function createRebuildScheduler(options: {
  run: () => void | Promise<void>
  onError?: (error: unknown) => void
  debounceMs?: number
}): {
  request(): void
  close(): void
}
