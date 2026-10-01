import {
  MAX_PROTOCOL_LINE_BYTES,
  PROTOCOL_VERSION,
  type CollectorToHost,
  type HostToCollector,
} from '../../shared/index.js'

export function encodeCollectorCommand(message: HostToCollector): string {
  return JSON.stringify(message) + '\n'
}

export function parseCollectorLine(line: string): CollectorToHost {
  if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
    throw new Error('collector protocol line exceeds byte limit')
  }
  let value: unknown
  try { value = JSON.parse(line) } catch { throw new Error('collector emitted invalid JSON') }
  if (!value || typeof value !== 'object') throw new Error('collector message must be an object')
  const record = value as Record<string, unknown>
  if (record.v !== PROTOCOL_VERSION) throw new Error('collector protocol version mismatch')
  if (typeof record.type !== 'string') throw new Error('collector message type missing')
  if (!['hello','observation','state','diagnostic','fatal'].includes(record.type)) {
    throw new Error('unknown collector message type')
  }
  return value as CollectorToHost
}
