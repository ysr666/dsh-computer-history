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
