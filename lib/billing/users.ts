import type { Tier } from './tiers'

export type BillingUser = {
  id: string
  tier: Tier
  periodStart: Date
  /** 订阅日/注册日锚点，滚动周期时不变（G4） */
  periodAnchor: Date
  periodEnd: Date | null
  isAdmin: boolean
}

export interface BillingUserRepo {
  get(userId: string): Promise<BillingUser | null>
  setPeriod(userId: string, periodStart: Date, periodEnd: Date): Promise<void>
}
