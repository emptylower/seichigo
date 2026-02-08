import { describe, expect, it } from 'vitest'
import {
  buildFingerprint,
  classifyNormalizedLogs,
  normalizeLogRecord,
  type NormalizedLogRecord,
} from '@/lib/ops/logClassifier'

function makeRecord(input: Partial<NormalizedLogRecord>): NormalizedLogRecord {
  return {
    deploymentId: 'd1',
    timestamp: null,
    requestId: null,
    path: '/api/test',
    method: 'GET',
    statusCode: null,
    message: 'hello',
    raw: { message: 'hello' },
    ...input,
  }
}

describe('ops log classifier', () => {
  it('marks 5xx logs as severe', () => {
    const events = classifyNormalizedLogs(
      [
        makeRecord({
          statusCode: 500,
          message: 'internal error',
        }),
      ],
      { warn4xxThreshold: 20 }
    )

    expect(events).toHaveLength(1)
    expect(events[0].severity).toBe('severe')
    expect(events[0].reason).toBe('status_5xx')
  })

  it('marks uncaught/unhandled keywords as severe', () => {
    const events = classifyNormalizedLogs(
      [
        makeRecord({
          statusCode: 200,
          message: 'Unhandled rejection in worker',
        }),
      ],
      { warn4xxThreshold: 20 }
    )

    expect(events).toHaveLength(1)
    expect(events[0].severity).toBe('severe')
    expect(events[0].reason).toBe('fatal_keyword')
  })

  it('promotes repeated 4xx events to warning when threshold is reached', () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      makeRecord({
        statusCode: 404,
        message: 'Not Found',
        requestId: `r-${i}`,
      })
    )

    const events = classifyNormalizedLogs(records, { warn4xxThreshold: 20 })
    expect(events).toHaveLength(20)
    expect(events.every((item) => item.severity === 'warning')).toBe(true)
    expect(events[0].reason).toContain('4xx_burst')
  })

  it('does not promote 4xx when threshold is not met', () => {
    const records = Array.from({ length: 19 }, (_, i) =>
      makeRecord({
        statusCode: 404,
        message: 'Not Found',
        requestId: `r-${i}`,
      })
    )

    const events = classifyNormalizedLogs(records, { warn4xxThreshold: 20 })
    expect(events).toHaveLength(0)
  })

  it('builds stable fingerprint for semantically identical logs', () => {
    const a = normalizeLogRecord(
      {
        statusCode: 500,
        message: 'Timeout while calling upstream requestId=12345',
        method: 'GET',
        path: '/api/x?id=1',
      },
      'd1'
    )

    const b = normalizeLogRecord(
      {
        statusCode: 500,
        message: 'Timeout while calling upstream requestId=67890',
        method: 'GET',
        path: '/api/x?id=2',
      },
      'd1'
    )

    expect(buildFingerprint(a)).toBe(buildFingerprint(b))
  })
})
