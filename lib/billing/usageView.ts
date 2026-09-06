import type { BillingAccount } from './service'
import { TIER_LABELS, type Tier } from './tiers'

/** 前端唯一可见的用量信息（设计 §4）：不含任何成本、token、调用次数 */
export type UsageView = {
  tier: Tier
  tierLabel: string
  remainingPercent: number
  /** 非管理员有余量但取整百分比已到 0：前端显示 "<1%" 而不是误导性的 "0%"（G10） */
  nearlyEmpty: boolean
  resetsAt: string
  upgradeAvailable: boolean
  hints: { transitEstimateOnly: boolean; restaurantsLocked: boolean; maxDays: number }
}

export function toUsageView(account: BillingAccount): UsageView {
  return {
    tier: account.tier,
    tierLabel: TIER_LABELS[account.tier],
    remainingPercent: account.isAdmin ? 100 : account.remainingPercent,
    nearlyEmpty: !account.isAdmin && account.balanceMicros > 0 && account.remainingPercent === 0,
    resetsAt: account.periodEnd.toISOString(),
    upgradeAvailable: !account.isAdmin && account.tier === 'free',
    hints: {
      transitEstimateOnly: !account.entitlements.directions,
      restaurantsLocked: !account.entitlements.restaurants,
      maxDays: account.entitlements.maxDays,
    },
  }
}
