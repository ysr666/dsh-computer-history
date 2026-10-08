import {
  EpisodeId,
  PolicyRuleId,
  validateConsentRule,
  type DeleteHistoryRequest,
  type PolicyRule,
  type PolicyUpdate,
} from '../../shared/index.js'

function record(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(
  value: unknown,
  name: string,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_000
  ) {
    throw new Error(
      `${name} must be a non-empty bounded string`,
    )
  }
  return value
}

function integer(
  value: unknown,
  name: string,
): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new Error(
      `${name} must be a non-negative safe integer`,
    )
  }
  return value
}

function boolean(
  value: unknown,
  name: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be boolean`)
  }
  return value
}
export function parseDeleteRequest(
  value: unknown,
): DeleteHistoryRequest {
  const body = record(value, 'deletion request')
  const scope = record(body.scope, 'deletion scope')
  const kind = text(scope.kind, 'deletion scope.kind')

  if (kind === 'all') {
    return { scope: { kind: 'all' } }
  }
  if (kind === 'episode') {
    return {
      scope: {
        kind: 'episode',
        episodeId: EpisodeId(
          text(
            scope.episodeId,
            'deletion scope.episodeId',
          ),
        ),
      },
    }
  }
  if (kind === 'app') {
    return {
      scope: {
        kind: 'app',
        bundleId: text(
          scope.bundleId,
          'deletion scope.bundleId',
        ),
      },
    }
  }
  if (kind === 'time-range') {
    const startMs = integer(
      scope.startMs,
      'deletion scope.startMs',
    )
    const endMs = integer(
      scope.endMs,
      'deletion scope.endMs',
    )
    if (endMs <= startMs) {
      throw new Error(
        'deletion scope.endMs must be greater than startMs',
      )
    }
    return {
      scope: {
        kind: 'time-range',
        startMs,
        endMs,
      },
    }
  }

  throw new Error(
    'deletion scope.kind is unsupported',
  )
}

function parseRule(
  value: unknown,
  index: number,
): PolicyRule {
  const rule = record(
    value,
    `policy rules[${index}]`,
  )
  const dimension = text(
    rule.dimension,
    `policy rules[${index}].dimension`,
  )
  const action = text(
    rule.action,
    `policy rules[${index}].action`,
  )
  const matcher = text(
    rule.matcher,
    `policy rules[${index}].matcher`,
  )

  if (
    dimension !== 'app'
    && dimension !== 'resource'
  ) {
    throw new Error(
      `policy rules[${index}].dimension is invalid`,
    )
  }
  if (
    action !== 'allow'
    && action !== 'deny'
    && action !== 'protect'
  ) {
    throw new Error(
      `policy rules[${index}].action is invalid`,
    )
  }
  if (
    matcher !== 'exact'
    && matcher !== 'prefix'
    && matcher !== 'glob'
  ) {
    throw new Error(
      `policy rules[${index}].matcher is invalid`,
    )
  }
  return {
    id: PolicyRuleId(
      text(rule.id, 'policy rule id'),
    ),
    dimension,
    action,
    matcher,
    pattern: text(
      rule.pattern,
      'policy rule pattern',
    ),
    builtIn: boolean(
      rule.builtIn,
      'policy rule builtIn',
    ),
    createdAtMs: integer(
      rule.createdAtMs,
      'policy rule createdAtMs',
    ),
    updatedAtMs: integer(
      rule.updatedAtMs,
      'policy rule updatedAtMs',
    ),
  }
}

export function parsePolicyUpdate(
  value: unknown,
): PolicyUpdate {
  const body = record(value, 'policy update')
  const mode = text(
    body.mode,
    'policy update.mode',
  )
  if (mode !== 'include-only') {
    throw new Error(
      'Phase 1 policy update.mode must be include-only',
    )
  }

  if (!Array.isArray(body.rules)) {
    throw new Error(
      'policy update.rules must be an array',
    )
  }
  if (body.rules.length > 256) {
    throw new Error(
      'policy update.rules is too large',
    )
  }

  const rules = body.rules.map(parseRule)
  if (!rules.every(validateConsentRule)) {
    throw new Error('resource consent rules must have canonical exact patterns')
  }
  return { mode, rules }
}
