import { monthlyBudgetMicros, remainingPercent, runCapMicros } from './budget'
import type { UsageLedgerRepo } from './ledger'
import { computePeriod } from './period'
import { RESERVE_MICROS } from './priceTable'
import { TIER_ENTITLEMENTS, type Entitlements, type Tier } from './tiers'
import type { BillingUserRepo } from './users'

export type BillingAccount = {
  userId: string
  tier: Tier
  entitlements: Entitlements
  isAdmin: boolean
  periodStart: Date
  periodEnd: Date
  budgetMicros: number
  balanceMicros: number
  remainingPercent: number
  runCapMicros: number
}

export type ReserveResult = { ok: true } | { ok: false; resetsAt: Date }

export type BillingService = {
  /** 读取账户并保证周期有效：periodEnd 为空或已过 → 滚动周期并写入整月 grant */
  getAccount(userId: string): Promise<BillingAccount | null>
  /**
   * 预扣。force=true 跳过余量检查（路由已在 beginAgentRun 之前做过预检，
   * 抢到 busy 位后无条件预扣，允许余量短暂为负，避免回滚已落库的人类消息）
   */
  reserveRun(input: { account: BillingAccount; planId: string; runRef: string; force?: boolean }): Promise<ReserveResult>
  /** 只读预检：余量是否够一次预扣；管理员恒 true */
  canStartRun(account: BillingAccount): boolean
  /** 按真实成本结算；hadModelOutput=false 时全额退回 */
  settleRun(input: { runRef: string; actualMicros: number; hadModelOutput: boolean }): Promise<void>
  /** 进程崩溃等留下的孤儿 reserve：早于 olderThan 且未配对的一律退回 */
  refundStaleReserves(userId: string, olderThan: Date): Promise<void>
}

export function createBillingService(deps: {
  ledger: UsageLedgerRepo
  users: BillingUserRepo
  now?: () => Date
}): BillingService {
  const now = deps.now ?? (() => new Date())

  async function getAccount(userId: string): Promise<BillingAccount | null> {
    const user = await deps.users.get(userId)
    if (!user) return null
    const budgetMicros = monthlyBudgetMicros(user.tier)
    const current = now()
    let { periodStart, periodEnd } = user
    if (!periodEnd || current.getTime() >= periodEnd.getTime()) {
      const next = computePeriod(user.periodStart, current)
      periodStart = next.periodStart
      periodEnd = next.periodEnd
      await deps.users.setPeriod(userId, periodStart, periodEnd)
    }
    const startForBalance = periodStart
    const balanceMicros = await deps.ledger.withUserLock(userId, async function (this: UsageLedgerRepo | void) {
      const ledger = (this as UsageLedgerRepo | undefined) ?? deps.ledger
      // 周期内还没有任何账目 → 写入整月 grant（幂等：有账目就不再写）
      if (await ledger.hasEntries(userId, startForBalance)) {
        return ledger.balance(userId, startForBalance)
      }
      const grant = await ledger.append({ userId, planId: null, runRef: null, kind: 'grant', deltaMicros: budgetMicros, periodStart: startForBalance })
      return grant.balanceAfter
    })
    return {
      userId,
      tier: user.tier,
      entitlements: TIER_ENTITLEMENTS[user.tier],
      isAdmin: user.isAdmin,
      periodStart,
      periodEnd: periodEnd as Date,
      budgetMicros,
      balanceMicros,
      remainingPercent: remainingPercent(balanceMicros, budgetMicros),
      runCapMicros: runCapMicros(user.tier),
    }
  }

  function canStartRun(account: BillingAccount): boolean {
    return account.isAdmin || account.balanceMicros >= RESERVE_MICROS[account.tier]
  }

  async function reserveRun(input: { account: BillingAccount; planId: string; runRef: string; force?: boolean }): Promise<ReserveResult> {
    const { account } = input
    if (account.isAdmin) return { ok: true }
    const amount = RESERVE_MICROS[account.tier]
    return deps.ledger.withUserLock(account.userId, async function (this: UsageLedgerRepo | void) {
      const ledger = (this as UsageLedgerRepo | undefined) ?? deps.ledger
      const balance = await ledger.balance(account.userId, account.periodStart)
      if (!input.force && balance < amount) return { ok: false as const, resetsAt: account.periodEnd }
      await ledger.append({
        userId: account.userId,
        planId: input.planId,
        runRef: input.runRef,
        kind: 'reserve',
        deltaMicros: -amount,
        periodStart: account.periodStart,
      })
      return { ok: true as const }
    })
  }

  async function settleRun(input: { runRef: string; actualMicros: number; hadModelOutput: boolean }): Promise<void> {
    const reserve = await deps.ledger.findOpenReserve(input.runRef)
    if (!reserve) return // 管理员或已结算/已退回
    const reserved = -reserve.deltaMicros
    const base = { userId: reserve.userId, planId: reserve.planId, runRef: reserve.runRef, periodStart: reserve.periodStart }
    if (!input.hadModelOutput) {
      await deps.ledger.append({ ...base, kind: 'refund', deltaMicros: reserved })
      return
    }
    // settle 的增量 = 预扣 − 实际：实际少于预扣补回差额，多于预扣继续扣（允许余量短暂为负）
    await deps.ledger.append({ ...base, kind: 'settle', deltaMicros: reserved - Math.max(0, Math.round(input.actualMicros)) })
  }

  async function refundStaleReserves(userId: string, olderThan: Date): Promise<void> {
    const stale = await deps.ledger.listOpenReserves(userId, olderThan)
    for (const reserve of stale) {
      await deps.ledger.append({
        userId: reserve.userId,
        planId: reserve.planId,
        runRef: reserve.runRef,
        kind: 'refund',
        deltaMicros: -reserve.deltaMicros,
        periodStart: reserve.periodStart,
      })
    }
  }

  return { getAccount, canStartRun, reserveRun, settleRun, refundStaleReserves }
}
