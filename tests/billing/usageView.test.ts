import { describe, expect, it } from 'vitest'
import { toUsageView } from '@/lib/billing/usageView'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'

describe('toUsageView', () => {
  it('exposes only tier, percent, reset date and hints', () => {
    const view = toUsageView({
      userId: 'u1',
      tier: 'free',
      entitlements: TIER_ENTITLEMENTS.free,
      isAdmin: false,
      periodStart: new Date('2026-08-20T00:00:00Z'),
      periodEnd: new Date('2026-09-20T00:00:00Z'),
      budgetMicros: 400_000,
      balanceMicros: 123_456,
      remainingPercent: 30,
      runCapMicros: 200_000,
    })
    expect(view).toEqual({
      tier: 'free',
      tierLabel: '免费',
      remainingPercent: 30,
      resetsAt: '2026-09-20T00:00:00.000Z',
      upgradeAvailable: true,
      nearlyEmpty: false,
      hints: { transitEstimateOnly: true, restaurantsLocked: true, maxDays: 3 },
    })
  })
  it('G10：非管理员有余量但取整百分比为 0 时标记 nearlyEmpty', () => {
    const view = toUsageView({
      userId: 'u1',
      tier: 'free',
      entitlements: TIER_ENTITLEMENTS.free,
      isAdmin: false,
      periodStart: new Date('2026-08-20T00:00:00Z'),
      periodEnd: new Date('2026-09-20T00:00:00Z'),
      budgetMicros: 400_000,
      balanceMicros: 999,
      remainingPercent: 0,
      runCapMicros: 200_000,
    })
    expect(view.nearlyEmpty).toBe(true)
  })
  it('admins always show 100% and no upgrade', () => {
    const view = toUsageView({
      userId: 'a',
      tier: 'free',
      entitlements: TIER_ENTITLEMENTS.free,
      isAdmin: true,
      periodStart: new Date(),
      periodEnd: new Date(),
      budgetMicros: 1,
      balanceMicros: 0,
      remainingPercent: 0,
      runCapMicros: 1,
    })
    expect(view.remainingPercent).toBe(100)
    expect(view.upgradeAvailable).toBe(false)
  })
})
