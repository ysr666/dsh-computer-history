import {
  MAX_PROTOCOL_LINE_BYTES,
  PROTOCOL_VERSION,
  type CollectorCapability,
  type CollectorToHost,
  type HostToCollector,
} from '../../shared/index.js'

type RecordValue = Record<string, unknown>

function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as RecordValue
}

function string(
  value: unknown,
  name: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function optionalString(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`)
  }
  return value
}

function finiteNumber(
  value: unknown,
  name: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`)
  }
  return value
}

function integer(
  value: unknown,
  name: string,
): number {
  const number = finiteNumber(value, name)
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${name} must be a safe integer`)
  }
  return number
}

function boolean(
  value: unknown,
  name: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`)
  }
  return value
}

function base(value: unknown): RecordValue {
  const message = record(value, 'collector message')
  if (message.v !== PROTOCOL_VERSION) {
    throw new Error('collector protocol version mismatch')
  }
  string(message.type, 'collector message type')
  return message
}

function parseHello(message: RecordValue): CollectorToHost {
  const capabilities = message.capabilities
  if (!Array.isArray(capabilities)) {
    throw new Error('hello capabilities must be an array')
  }
  const allowed = new Set<CollectorCapability>([
    'app-focus',
    'window-metadata',
    'resource-uri',
    'secure-field-detection',
  ])
  const parsed = capabilities.map((value, index) => {
    const capability = string(
      value,
      `hello capabilities[${index}]`,
    ) as CollectorCapability
    if (!allowed.has(capability)) {
      throw new Error(
        `unsupported collector capability: ${capability}`,
      )
    }
    return capability
  })

  const platform = string(message.platform, 'hello platform')
  if (platform !== 'darwin') {
    throw new Error('collector platform mismatch')
  }

  const arch = string(message.arch, 'hello arch')
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error('unsupported collector architecture')
  }

  return {
    v: 1,
    type: 'hello',
    collectorSession: string(
      message.collectorSession,
      'hello collectorSession',
    ),
    collectorVersion: string(
      message.collectorVersion,
      'hello collectorVersion',
    ),
    platform: 'darwin',
    arch,
    capabilities: parsed,
  }
}

function parseOptionalStringRecord(
  value: unknown,
  name: string,
  keys: readonly string[],
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  const source = record(value, name)
  const result: Record<string, string> = {}
  for (const key of keys) {
    const parsed = optionalString(source[key], `${name}.${key}`)
    if (parsed !== undefined) result[key] = parsed
  }
  return result
}

function parseObservation(
  message: RecordValue,
): CollectorToHost {
  const app = record(message.app, 'observation.app')
  const privacy = record(
    message.privacy,
    'observation.privacy',
  )
  const source = record(message.source, 'observation.source')
  const activity = message.activity === undefined
    || message.activity === null
    ? undefined
    : record(message.activity, 'observation.activity')

  const idleSeconds = activity?.idleSeconds === undefined
    || activity.idleSeconds === null
    ? undefined
    : finiteNumber(
        activity.idleSeconds,
        'observation.activity.idleSeconds',
      )

  if (idleSeconds !== undefined && idleSeconds < 0) {
    throw new Error(
      'observation.activity.idleSeconds must be non-negative',
    )
  }

  const appName = optionalString(
    app.name,
    'observation.app.name',
  )
  const privacyReason = optionalString(
    privacy.reason,
    'observation.privacy.reason',
  )
  const window = parseOptionalStringRecord(
    message.window,
    'observation.window',
    ['title', 'document', 'url'],
  )
  const element = parseOptionalStringRecord(
    message.element,
    'observation.element',
    ['role', 'subrole', 'identifier', 'title'],
  )

  return {
    v: 1,
    type: 'observation',
    collectorSession: string(
      message.collectorSession,
      'observation.collectorSession',
    ),
    seq: integer(message.seq, 'observation.seq'),
    observedAtMs: integer(
      message.observedAtMs,
      'observation.observedAtMs',
    ),
    app: {
      pid: integer(app.pid, 'observation.app.pid'),
      bundleId: string(
        app.bundleId,
        'observation.app.bundleId',
      ),
      ...(appName === undefined ? {} : { name: appName }),
    },
    ...(window === undefined ? {} : { window }),
    ...(element === undefined ? {} : { element }),
    ...(idleSeconds === undefined
      ? {}
      : { activity: { idleSeconds } }),
    privacy: {
      secure: boolean(
        privacy.secure,
        'observation.privacy.secure',
      ),
      protected: boolean(
        privacy.protected,
        'observation.privacy.protected',
      ),
      ...(privacyReason === undefined
        ? {}
        : { reason: privacyReason }),
    },
    source: {
      adapter: string(
        source.adapter,
        'observation.source.adapter',
      ),
    },
  }
}

function parseState(message: RecordValue): CollectorToHost {
  const state = string(message.state, 'collector state')
  if (
    state !== 'running'
    && state !== 'paused'
    && state !== 'permission-required'
    && state !== 'degraded'
  ) {
    throw new Error('invalid collector state')
  }

  const reason = optionalString(
    message.reason,
    'state.reason',
  )

  return {
    v: 1,
    type: 'state',
    state,
    accessibilityTrusted: boolean(
      message.accessibilityTrusted,
      'state.accessibilityTrusted',
    ),
    ...(reason === undefined ? {} : { reason }),
  }
}

function parseDiagnostic(
  message: RecordValue,
): CollectorToHost {
  const level = string(
    message.level,
    'diagnostic.level',
  )
  if (
    level !== 'debug'
    && level !== 'info'
    && level !== 'warn'
  ) {
    throw new Error('invalid diagnostic level')
  }

  return {
    v: 1,
    type: 'diagnostic',
    level,
    code: string(message.code, 'diagnostic.code'),
    message: string(
      message.message,
      'diagnostic.message',
    ),
  }
}

function parseFatal(message: RecordValue): CollectorToHost {
  return {
    v: 1,
    type: 'fatal',
    code: string(message.code, 'fatal.code'),
    message: string(message.message, 'fatal.message'),
  }
}

export function encodeCollectorCommand(
  message: HostToCollector,
): string {
  return JSON.stringify(message) + '\n'
}

export function parseCollectorLine(
  line: string,
): CollectorToHost {
  if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
    throw new Error(
      'collector protocol line exceeds byte limit',
    )
  }

  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error('collector emitted invalid JSON')
  }

  const message = base(value)
  switch (message.type) {
    case 'hello':
      return parseHello(message)
    case 'observation':
      return parseObservation(message)
    case 'state':
      return parseState(message)
    case 'diagnostic':
      return parseDiagnostic(message)
    case 'fatal':
      return parseFatal(message)
    default:
      throw new Error(
        `unknown collector message type: ${String(message.type)}`,
      )
  }
}
