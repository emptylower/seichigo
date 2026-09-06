import type { Tier } from '@/lib/billing/tiers'

/** 与 prisma BillingSubscription 同形（设计 2026-09-06 §3） */
export type SubscriptionRecord = {
  id: string
  userId: string
  provider: string
  creemCustomerId: string
  creemSubscriptionId: string
  creemProductId: string
  tier: string
  status: string
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  canceledAt: Date | null
  lastEventAt: Date
  createdAt: Date
  updatedAt: Date
}

/** 视为"有效订阅"的 Creem 状态（findActiveByUser 与 reconcile 共用） */
export const ACTIVE_SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'trialing', 'past_due', 'scheduled_cancel']

export interface BillingSubscriptionRepo {
  findByCreemId(id: string): Promise<SubscriptionRecord | null>
  /** status in active/trialing/past_due/scheduled_cancel；同一用户多条时取最新 */
  findActiveByUser(userId: string): Promise<SubscriptionRecord | null>
  /** status 活跃且 currentPeriodEnd < olderThan（对账候选） */
  listNeedingReconcile(olderThan: Date): Promise<SubscriptionRecord[]>
  upsert(record: Omit<SubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SubscriptionRecord>
}

export interface BillingWebhookEventRepo {
  /** 以事件 id 幂等落库：首次 'new'，重复 'duplicate' */
  claim(event: { id: string; type: string; payload: unknown }): Promise<'new' | 'duplicate'>
  markProcessed(id: string, error?: string): Promise<void>
}

export interface UserTierRepo {
  findUserIdByEmail(email: string): Promise<string | null>
  /**
   * 事务内改写 User.tier 与周期（取 pg_advisory_xact_lock(hashtext(userId))）。
   * periodAnchor 省略时锚点保持不变（subscription.paid 只推进周期，设计 §4）。
   */
  applyTier(input: {
    userId: string
    tier: Tier
    periodAnchor?: Date
    periodStart: Date
    periodEnd: Date
  }): Promise<void>
}
