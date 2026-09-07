/**
 * 每日对账（设计 §7）：currentPeriodEnd 已过 48 小时仍未收到续费事件的订阅，
 * 逐条查询 Creem 并包装成合成事件交给状态机修正。
 * F2：追加“已到期待降档”候选（canceled/expired/scheduled_cancel 且用户仍非 free）。
 * F3：重放处理失败的 webhook 事件。
 * F8：远端状态不可能恢复且周期已过 → 直接降档。
 * F9：404 降档熔断。F12：合成事件落 events 审计（type 前缀 reconcile.）。
 */

import type { CreemClient } from './client'
import type { BillingSubscriptionRepo, BillingWebhookEventRepo, UserTierRepo } from './repo'
import { downgradeUserToFree, handleCreemEvent, parseCreemEvent, toDate, type CreemEvent } from './webhookHandler'

export const RECONCILE_LAG_MS = 48 * 60 * 60 * 1000

/** F3：单轮重放的失败事件上限 */
const REPLAY_LIMIT = 20

/** F8：远端状态仍在这些之内时按周期同步；否则周期已过即直接降档 */
const RECONCILE_KEEP_STATUSES: readonly string[] = ['active', 'trialing', 'scheduled_cancel']

/** active→paid（推进周期）；canceled/expired→expired；paused→paused；其它→update */
export function reconcileEventType(status: string): string {
  if (status === 'active') return 'subscription.paid'
  if (status === 'canceled' || status === 'expired') return 'subscription.expired'
  if (status === 'paused') return 'subscription.paused'
  return 'subscription.update'
}

export type ReconcileResult = { checked: number; handled: number; errors: number; replayed: number; breakerTripped: boolean }

export async function runBillingReconcile(deps: {
  client: Pick<CreemClient, 'getSubscription'>
  subs: BillingSubscriptionRepo
  users: UserTierRepo
  events: BillingWebhookEventRepo
  now?: () => Date
  log?: (level: 'warn' | 'error', msg: string, extra?: unknown) => void
}): Promise<ReconcileResult> {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})

  // F3：重放处理失败的事件（webhook 路由 claim 占位但未 processed 的）
  let replayed = 0
  for (const stored of await deps.events.listUnprocessed(REPLAY_LIMIT)) {
    try {
      const parsed = parseCreemEvent(stored.payload)
      if (!parsed) throw new Error('replay payload unparseable')
      const result = await handleCreemEvent(parsed, { subs: deps.subs, users: deps.users, now, log })
      if (!result.handled) throw new Error(`replay not handled: ${result.note ?? parsed.eventType}`)
      await deps.events.markProcessed(stored.id)
      replayed += 1
    } catch (err) {
      await deps.events.markProcessed(stored.id, String((err as Error | undefined)?.message ?? err))
    }
  }

  const olderThan = new Date(now().getTime() - RECONCILE_LAG_MS)
  const stale = await deps.subs.listNeedingReconcile(olderThan)

  // F9：本轮允许的 404 降档上限 = max(3, ceil(候选数 × 0.2))，超过即熔断
  const notFoundLimit = Math.max(3, Math.ceil(stale.length * 0.2))
  let notFoundDowngrades = 0
  let breakerTripped = false

  const processedIds = new Set<string>()
  let handled = 0
  let errors = 0
  for (const subscription of stale) {
    try {
      const remote = await deps.client.getSubscription(subscription.creemSubscriptionId)
      if (!remote) {
        if (notFoundDowngrades >= notFoundLimit) {
          if (!breakerTripped) {
            breakerTripped = true
            console.error('[billing/reconcile] circuit breaker tripped', {
              notFoundDowngrades,
              limit: notFoundLimit,
              candidates: stale.length,
            })
          }
          continue
        }
        notFoundDowngrades += 1
      }
      const status = remote && typeof remote.status === 'string' && remote.status ? remote.status : 'expired'

      // F8：远端状态已不可能恢复（past_due/canceled/expired/paused/unpaid 等）且周期已过 → 直接降档
      if (remote && !RECONCILE_KEEP_STATUSES.includes(status)) {
        const remoteEnd = toDate(remote.current_period_end_date)
        if (remoteEnd && remoteEnd.getTime() <= now().getTime()) {
          await deps.subs.upsert({
            userId: subscription.userId,
            provider: subscription.provider,
            creemCustomerId: subscription.creemCustomerId,
            creemSubscriptionId: subscription.creemSubscriptionId,
            creemProductId: subscription.creemProductId,
            tier: subscription.tier,
            status: 'expired',
            currentPeriodStart: toDate(remote.current_period_start_date) ?? subscription.currentPeriodStart,
            currentPeriodEnd: remoteEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: subscription.canceledAt,
            lastEventAt: now(),
          })
          await downgradeUserToFree(deps.users, subscription.userId, now())
          processedIds.add(subscription.creemSubscriptionId)
          handled += 1
          continue
        }
      }

      const object: Record<string, unknown> = remote
        ? (remote as Record<string, unknown>)
        : {
            // Creem 侧已查不到（404）：按本记录数据合成 expired，让状态机走降档路径
            id: subscription.creemSubscriptionId,
            status: 'expired',
            current_period_start_date: subscription.currentPeriodStart.getTime(),
            current_period_end_date: subscription.currentPeriodEnd.getTime(),
            customer: { id: subscription.creemCustomerId },
            metadata: { userId: subscription.userId, tier: subscription.tier },
          }
      const event: CreemEvent = {
        id: `reconcile_${subscription.id}_${now().getTime()}`,
        eventType: reconcileEventType(status),
        created_at: now().getTime(),
        object,
      }
      // F12：合成事件也落审计
      await deps.events.claim({ id: event.id, type: `reconcile.${event.eventType}`, payload: event })
      const result = await handleCreemEvent(event, { subs: deps.subs, users: deps.users, now, log })
      if (result.handled) handled += 1
      await deps.events.markProcessed(event.id)
      processedIds.add(subscription.creemSubscriptionId)
    } catch (err) {
      errors += 1
      log('error', 'billing reconcile item failed', {
        subscriptionId: subscription.id,
        error: String((err as Error | undefined)?.message ?? err),
      })
    }
  }

  // F2：canceled/expired/scheduled_cancel 已到期、对应用户仍非 free → 降档
  const expiredPending = (await deps.subs.listExpiredPendingDowngrade(now())).filter(
    (record) => !processedIds.has(record.creemSubscriptionId),
  )
  for (const subscription of expiredPending) {
    try {
      await downgradeUserToFree(deps.users, subscription.userId, now())
      handled += 1
    } catch (err) {
      errors += 1
      log('error', 'billing reconcile downgrade failed', {
        subscriptionId: subscription.id,
        error: String((err as Error | undefined)?.message ?? err),
      })
    }
  }

  return { checked: stale.length, handled, errors, replayed, breakerTripped }
}
