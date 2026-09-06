import type { Tier } from './tiers'

export type BillingUser = {
  id: string
  tier: Tier
  periodStart: Date
  periodEnd: Date | null
  isAdmin: boolean
}

export interface BillingUserRepo {
  get(userId: string): Promise<BillingUser | null>
  setPeriod(userId: string, periodStart: Date, periodEnd: Date): Promise<void>
}
