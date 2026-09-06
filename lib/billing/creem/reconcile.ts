/**
 * 每日对账（设计 §7）：currentPeriodEnd 已过 48 小时仍未收到续费事件的订阅，
 * 逐条查询 Creem 并包装成合成事件交给状态机修正。
 */

import type { CreemClient } from './client'
import type { BillingSubscriptionRepo, UserTierRepo } from './repo'
import { handleCreemEvent, type CreemEvent } from './webhookHandler'

export const RECONCILE_LAG_MS = 48 * 60 * 60 * 1000

/** active→paid（推进周期）；canceled/expired→expired；paused→paused；其它→update */
export function reconcileEventType(status: string): string {
  if (status === 'active') return 'subscription.paid'
  if (status === 'canceled' || status === 'expired') return 'subscription.expired'
  if (status === 'paused') return 'subscription.paused'
  return 'subscription.update'
}

export type ReconcileResult = { checked: number; handled: number; errors: number }

export async function runBillingReconcile(deps: {
  client: Pick<CreemClient, 'getSubscription'>
  subs: BillingSubscriptionRepo
  users: UserTierRepo
  now?: () => Date
  log?: (level: 'warn' | 'error', msg: string, extra?: unknown) => void
}): Promise<ReconcileResult> {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})

  const olderThan = new Date(now().getTime() - RECONCILE_LAG_MS)
  const stale = await deps.subs.listNeedingReconcile(olderThan)

  let handled = 0
  let errors = 0
  for (const subscription of stale) {
    try {
      let object: Record<string, unknown>
      const remote = await deps.client.getSubscription(subscription.creemSubscriptionId)
      if (remote) {
        object = remote as Record<string, unknown>
      } else {
        // Creem 侧已查不到（404）：按本记录数据合成 expired，让状态机走降档路径
        object = {
          id: subscription.creemSubscriptionId,
          status: 'expired',
          current_period_start_date: subscription.currentPeriodStart.getTime(),
          current_period_end_date: subscription.currentPeriodEnd.getTime(),
          customer: { id: subscription.creemCustomerId },
          metadata: { userId: subscription.userId, tier: subscription.tier },
        }
      }
      const status = typeof object.status === 'string' && object.status ? object.status : 'active'
      const event: CreemEvent = {
        id: `reconcile_${subscription.id}_${now().getTime()}`,
        eventType: reconcileEventType(status),
        created_at: now().getTime(),
        object,
      }
      const result = await handleCreemEvent(event, { subs: deps.subs, users: deps.users, now, log })
      if (result.handled) handled += 1
    } catch (err) {
      errors += 1
      log('error', 'billing reconcile item failed', {
        subscriptionId: subscription.id,
        error: String((err as Error | undefined)?.message ?? err),
      })
    }
  }
  return { checked: stale.length, handled, errors }
}
