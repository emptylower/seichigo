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
  /** F2：status in canceled/expired/scheduled_cancel 且 currentPeriodEnd <= now 且用户 tier 仍非 free */
  listExpiredPendingDowngrade(now: Date): Promise<SubscriptionRecord[]>
  upsert(record: Omit<SubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SubscriptionRecord>
}

/** F3：失败事件的最大重放次数，超过后不再进入重放候选 */
export const WEBHOOK_MAX_ATTEMPTS = 5

export interface BillingWebhookEventRepo {
  /** 以事件 id 幂等落库：首次 'new'，重复 'duplicate' */
  claim(event: { id: string; type: string; payload: unknown }): Promise<'new' | 'duplicate'>
  /** F3：成功写 processedAt；失败不写 processedAt，只记 error 与 attempts+1 */
  markProcessed(id: string, error?: string): Promise<void>
  /** F3：processedAt 为 null 且 attempts < 上限（对账重放候选） */
  listUnprocessed(limit: number): Promise<Array<{ id: string; type: string; payload: unknown }>>
  /** F11：最近 withinMs 内是否存在 payload.userId 匹配的同类型记录（结账去重） */
  findRecentByType(type: string, userId: string, withinMs: number): Promise<boolean>
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
