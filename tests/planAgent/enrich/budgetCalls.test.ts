import { describe, expect, it } from 'vitest'
import { countGoogleCall, createEnrichBudget, meterGoogleCall } from '@/lib/planAgent/enrich/types'

describe('EnrichBudget call meter', () => {
  it('countGoogleCall bumps the window bucket and the per-run category', () => {
    const budget = createEnrichBudget()
    countGoogleCall(budget, 'placesTextSearch')
    countGoogleCall(budget, 'placesNearby')
    countGoogleCall(budget, 'placeDetails')
    countGoogleCall(budget, 'directions')
    expect(budget.places.used).toBe(3)
    expect(budget.directions.used).toBe(1)
    const calls = budget.calls
    expect(calls).toEqual({ placesTextSearch: 1, placesNearby: 1, placeDetails: 1, directions: 1 })
  })

  it('meterGoogleCall only bumps the per-run category (budget already pre-deducted)', () => {
    const budget = createEnrichBudget()
    meterGoogleCall(budget, 'placesNearby')
    expect(budget.places.used).toBe(0)
    expect(budget.calls?.placesNearby).toBe(1)
  })

  it('tolerates budgets constructed without calls (legacy literals in tests)', () => {
    const budget = { directions: { used: 0, max: 40 }, places: { used: 0, max: 40 }, windowStartedAt: Date.now() }
    countGoogleCall(budget, 'directions')
    expect(budget.directions.used).toBe(1)
    expect((budget as { calls?: unknown }).calls).toEqual({ placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 1 })
  })
})
