import { describe, expect, it } from 'vitest'
import type { MapImageDiagApiDeps } from '@/lib/mapImageDiag/api'
import { summarizeMapImageDiagRange } from '@/lib/mapImageDiag/service'

function createDeps(params: {
  sessions: Array<{
    id: string
    createdAt: Date
    surface: string
    sampled: boolean
    escalationReason: string | null
    sessionOutcome: string | null
    firstDegradedStage: string | null
    eventCount: number
    proxyInvolved: boolean
  }>
  events: Array<{
    createdAt: Date
    stage: string
    terminalState: string | null
    displayOutcome: string | null
    durationMs: number | null
  }>
}): MapImageDiagApiDeps {
  return {
    prisma: {
      mapImageDiagSession: {
        findMany: async () => params.sessions,
      },
      mapImageDiagEvent: {
        findMany: async () => params.events,
      },
    },
    getSession: async () => null,
    now: () => new Date('2026-04-18T00:00:00.000Z'),
  } as MapImageDiagApiDeps
}

describe('summarizeMapImageDiagRange duration summaries', () => {
  const range = {
    start: new Date('2026-04-18T00:00:00.000Z'),
    end: new Date('2026-04-18T01:00:00.000Z'),
  }

  it('never reports avgDurationMs above p95DurationMs for skewed stage and total durations', async () => {
    const events = [
      ...Array.from({ length: 20 }, (_, index) => ({
        createdAt: new Date(`2026-04-18T00:${String(index).padStart(2, '0')}:00.000Z`),
        stage: 'dom_request_terminal',
        terminalState: 'succeeded',
        displayOutcome: 'visible',
        durationMs: 100,
      })),
      {
        createdAt: new Date('2026-04-18T00:30:00.000Z'),
        stage: 'dom_request_terminal',
        terminalState: 'succeeded',
        displayOutcome: 'visible',
        durationMs: 10_000,
      },
    ]
    const result = await summarizeMapImageDiagRange(
      createDeps({
        sessions: [
          {
            id: 'session-1',
            createdAt: new Date('2026-04-18T00:30:00.000Z'),
            surface: 'map',
            sampled: true,
            escalationReason: 'slow',
            sessionOutcome: 'fallback',
            firstDegradedStage: 'dom_request_terminal',
            eventCount: events.length,
            proxyInvolved: false,
          },
        ],
        events,
      }),
      range,
    )

    expect(result.stageStats).toHaveLength(1)
    expect(result.stageStats[0]).toMatchObject({
      stage: 'dom_request_terminal',
      avgDurationMs: 571,
      p95DurationMs: 571,
    })
    expect(result.stageStats[0]?.p95DurationMs).toBeGreaterThanOrEqual(result.stageStats[0]?.avgDurationMs ?? 0)
    expect(result.totals.avgDurationMs).toBe(571)
    expect(result.totals.p95DurationMs).toBe(571)
    expect(result.totals.p95DurationMs).toBeGreaterThanOrEqual(result.totals.avgDurationMs ?? 0)
  })

  it('preserves null duration summaries for empty populations', async () => {
    const result = await summarizeMapImageDiagRange(
      createDeps({
        sessions: [],
        events: [],
      }),
      range,
    )

    expect(result.stageStats).toEqual([])
    expect(result.totals.avgDurationMs).toBeNull()
    expect(result.totals.p95DurationMs).toBeNull()
  })
})
