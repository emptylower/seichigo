import { describe, expect, it } from 'vitest'
import { monthlyBudgetMicros, remainingPercent, runCapMicros } from '@/lib/billing/budget'
import { CNY_PER_USD, COST_SHARE, FREE_BUDGET_MICROS, RUN_CAP_SHARE, TIER_MONTHLY_PRICE_CNY } from '@/lib/billing/priceTable'

describe('budget', () => {
  it('free budget is the fixed constant', () => {
    expect(monthlyBudgetMicros('free')).toBe(FREE_BUDGET_MICROS)
  })
  it('paid budget = price / fx × cost share, in micro-USD', () => {
    const expected = Math.round((TIER_MONTHLY_PRICE_CNY.standard / CNY_PER_USD) * COST_SHARE * 1_000_000)
    expect(monthlyBudgetMicros('standard')).toBe(expected)
  })
  it('run cap is a share of the monthly budget', () => {
    expect(runCapMicros('free')).toBe(Math.round(FREE_BUDGET_MICROS * RUN_CAP_SHARE.free))
    expect(runCapMicros('standard')).toBe(Math.round(monthlyBudgetMicros('standard') * RUN_CAP_SHARE.standard))
  })
  it('remainingPercent floors, clamps at 0 and 100', () => {
    expect(remainingPercent(999, 1000)).toBe(99)
    expect(remainingPercent(1000, 1000)).toBe(100)
    expect(remainingPercent(-5, 1000)).toBe(0)
    expect(remainingPercent(5, 0)).toBe(0)
  })
})
