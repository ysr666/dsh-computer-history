import {
  describe,
  expect,
  it,
} from 'vitest'
import {
  parseDeleteRequest,
  parsePolicyUpdate,
} from '../../src/host/api/index.js'

describe('history API validation', () => {
  it('accepts bounded deletion requests', () => {
    expect(parseDeleteRequest({
      scope: {
        kind: 'time-range',
        startMs: 10,
        endMs: 20,
      },
    })).toEqual({
      scope: {
        kind: 'time-range',
        startMs: 10,
        endMs: 20,
      },
    })
  })

  it('rejects malformed deletion requests', () => {
    expect(() => parseDeleteRequest({
      scope: {
        kind: 'time-range',
        startMs: 20,
        endMs: 10,
      },
    })).toThrow(/greater than/)
    expect(() => parseDeleteRequest({
      scope: {
        kind: 'unknown',
      },
    })).toThrow(/unsupported/)
  })

  it('rejects malformed policy updates', () => {
    expect(() => parsePolicyUpdate({
      mode: 'exclude',
      rules: [],
    })).toThrow(/include-only/)

    expect(() => parsePolicyUpdate({
      mode: 'include-only',
      rules: [{
        id: 'bad',
        dimension: 'app',
        action: 'allow',
        matcher: 'regex',
        pattern: 'com.example.App',
        builtIn: false,
        createdAtMs: 1,
        updatedAtMs: 1,
      }],
    })).toThrow(/matcher/)
  })
})
