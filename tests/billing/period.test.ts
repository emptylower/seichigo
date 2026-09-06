import { describe, expect, it } from 'vitest'
import { addMonthsClamped, computePeriod } from '@/lib/billing/period'

describe('period', () => {
  it('addMonthsClamped clamps to the last day of shorter months', () => {
    expect(addMonthsClamped(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(addMonthsClamped(new Date('2026-03-15T10:00:00Z'), 1).toISOString()).toBe('2026-04-15T10:00:00.000Z')
  })
  it('computePeriod returns the current window containing now, anchored on the subscription day', () => {
    const anchor = new Date('2026-06-10T00:00:00Z')
    const { periodStart, periodEnd } = computePeriod(anchor, new Date('2026-09-06T12:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-08-10T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-09-10T00:00:00.000Z')
  })
  it('computePeriod with now before anchor returns the first window', () => {
    const anchor = new Date('2026-09-10T00:00:00Z')
    const { periodStart, periodEnd } = computePeriod(anchor, new Date('2026-09-06T00:00:00Z'))
    expect(periodStart).toEqual(anchor)
    expect(periodEnd.toISOString()).toBe('2026-10-10T00:00:00.000Z')
  })
  it('G4：1/31 锚点在 3/15 滚动到 2/28–3/31（月末日跟随锚点而不是漂移）', () => {
    const { periodStart, periodEnd } = computePeriod(new Date('2026-01-31T00:00:00Z'), new Date('2026-03-15T00:00:00Z'))
    expect(periodStart.toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-03-31T00:00:00.000Z')
  })
})
