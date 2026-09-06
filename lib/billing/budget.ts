import type { Tier } from './tiers'
import { CNY_PER_USD, COST_SHARE, FREE_BUDGET_MICROS, RUN_CAP_SHARE, TIER_MONTHLY_PRICE_CNY } from './priceTable'

/** 月度成本预算（微美元）：免费档固定值；付费档 = 月价 / 汇率 × 成本占比 */
export function monthlyBudgetMicros(tier: Tier): number {
  if (tier === 'free') return FREE_BUDGET_MICROS
  return Math.round((TIER_MONTHLY_PRICE_CNY[tier] / CNY_PER_USD) * COST_SHARE * 1_000_000)
}

/** 单 run 成本上限（微美元） */
export function runCapMicros(tier: Tier): number {
  return Math.round(monthlyBudgetMicros(tier) * RUN_CAP_SHARE[tier])
}

/** 用户可见的剩余百分比：向下取整，0..100 */
export function remainingPercent(balanceMicros: number, budgetMicros: number): number {
  if (budgetMicros <= 0) return 0
  return Math.max(0, Math.min(100, Math.floor((balanceMicros / budgetMicros) * 100)))
}
