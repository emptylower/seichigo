import { describe, expect, it } from 'vitest'
import { forbiddenToolsOf, parseTier, TIER_ENTITLEMENTS, tierPromptNote } from '@/lib/billing/tiers'

describe('tiers', () => {
  it('parseTier defaults to free for unknown values', () => {
    expect(parseTier('standard')).toBe('standard')
    expect(parseTier('pro')).toBe('pro')
    expect(parseTier('gold')).toBe('free')
    expect(parseTier(undefined)).toBe('free')
  })

  it('free tier has no directions and no restaurants', () => {
    const free = TIER_ENTITLEMENTS.free
    expect(free.directions).toBe(false)
    expect(free.restaurants).toBe(false)
    expect(free.directionsMax).toBe(0)
    expect(free.maxDays).toBe(3)
    expect([...forbiddenToolsOf(free)].sort()).toEqual(['estimate_travel', 'find_restaurants'])
    expect(tierPromptNote(free)).toContain('直线估算')
  })

  it('standard tier has full current features and nothing forbidden', () => {
    const std = TIER_ENTITLEMENTS.standard
    expect(std.directions).toBe(true)
    expect(std.restaurants).toBe(true)
    expect(std.maxDays).toBe(7)
    expect(forbiddenToolsOf(std).size).toBe(0)
    expect(tierPromptNote(std)).toBeNull()
  })

  it('pro is not purchasable yet', () => {
    expect(TIER_ENTITLEMENTS.pro.purchasable).toBe(false)
    expect(TIER_ENTITLEMENTS.standard.purchasable).toBe(true)
  })
})
