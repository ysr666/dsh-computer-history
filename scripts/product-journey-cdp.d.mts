interface CdpSocket extends EventTarget {
  readyState: number
  send(payload: string): void
  close(): void
}

export declare function connectCdp(
  url: string,
  options?: {
    WebSocketImpl?: new (url: string) => CdpSocket
    connectTimeoutMs?: number
    commandTimeoutMs?: number
  },
): Promise<{
  ws: CdpSocket
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}>

export declare function initializeCdpSession(
  getTargetUrl: () => Promise<string>,
  options?: {
    connectImpl?: (url: string) => Promise<{
      ws: CdpSocket
      send(method: string, params?: Record<string, unknown>): Promise<unknown>
    }>
    attempts?: number
    delayMs?: number
    onRetry?: (attempt: number, error: unknown) => void
  },
): Promise<{
  ws: CdpSocket
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}>
