import { describe, expect, it, vi } from 'vitest'
import { runEnrichers } from '@/lib/planAgent/enrich'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'
import type { EnrichDay } from '@/lib/planAgent/enrich/types'

describe('restaurant enricher under free tier', () => {
  it('skips meal items with a tier reason and never calls findRestaurants', async () => {
    const findRestaurants = vi.fn()
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', sortOrder: 0 } as never,
          { type: 'meal', title: '午餐', sortOrder: 1 } as never,
        ],
      },
    ]
    const { report } = await runEnrichers(days, {
      deps: { findRestaurants },
      coordsByPointId: new Map([['p1', { lat: 35, lng: 139 }]]),
      entitlements: TIER_ENTITLEMENTS.free,
    })
    expect(findRestaurants).not.toHaveBeenCalled()
    expect(report.skipped.some((s) => s.enricher === 'restaurant' && s.reason.includes('档位'))).toBe(true)
  })
})
