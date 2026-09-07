import { monthlyBudgetMicros, remainingPercent, runCapMicros } from './budget'
import type { UsageLedgerRepo } from './ledger'
import { computePeriod } from './period'
import { RESERVE_MICROS } from './priceTable'
import { TIER_ENTITLEMENTS, type Entitlements, type Tier } from './tiers'
import type { BillingUserRepo } from './users'

/**
 * 孤儿预扣判定阈值（G1）：软截止 13 分钟 + 两倍 busy TTL 的余量。
 * 真实 run 靠续租可跑到 13 分钟，早于这个阈值的"未配对 reserve"仍有可能是
 * 活 run；只有超过它才允许进入孤儿退款候选（还需 isRunActive 复核）。
 */
export const STALE_RESERVE_AFTER_MS = 16 * 60 * 1000

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
  /** 按真实成本结算；hadModelOutput=false 时全额退回；reserve 被误退时仍补记实际成本 */
  settleRun(input: { runRef: string; actualMicros: number; hadModelOutput: boolean }): Promise<void>
  /** run 结束后的额外成本（补齐续跑的 Google 调用等）：追加一条负 settle */
  chargeExtra(input: { runRef: string; micros: number }): Promise<void>
  /** 进程崩溃等留下的孤儿 reserve：早于 olderThan、未配对且 run 已不活跃的一律退回 */
  refundStaleReserves(userId: string, olderThan: Date): Promise<void>
}

export function createBillingService(deps: {
  ledger: UsageLedgerRepo
  users: BillingUserRepo
  /** run 是否仍在跑（tripPlan.agentRunToken 仍等于 runRef）；孤儿退款前复核用 */
  isRunActive: (planId: string, runRef: string) => Promise<boolean>
  /** F2：读时兜底降档用——用户是否仍有活跃订阅（active/trialing/past_due/scheduled_cancel） */
  subscriptions?: { findActiveByUser(userId: string): Promise<{ currentPeriodEnd: Date } | null> }
  now?: () => Date
}): BillingService {
  const now = deps.now ?? (() => new Date())

  async function getAccount(userId: string): Promise<BillingAccount | null> {
    const user = await deps.users.get(userId)
    if (!user) return null
    const current = now()

    // F2：非 free、非管理员、无活跃订阅且 periodEnd 已过 → 兜底降为 free（防未到期的取消/过期事件丢失）
    let tier = user.tier
    let periodAnchor = user.periodAnchor
    let periodStart = user.periodStart
    let periodEnd = user.periodEnd
    if (
      deps.subscriptions &&
      tier !== 'free' &&
      !user.isAdmin &&
      periodEnd &&
      current.getTime() >= periodEnd.getTime() &&
      !(await deps.subscriptions.findActiveByUser(userId))
    ) {
      const at = now()
      const free = computePeriod(at, at)
      await deps.users.setTier(userId, 'free', at, free.periodStart, free.periodEnd)
      tier = 'free'
      periodAnchor = at
      periodStart = free.periodStart
      periodEnd = free.periodEnd
    }

    const budgetMicros = monthlyBudgetMicros(tier)
    if (!periodEnd || current.getTime() >= periodEnd.getTime()) {
      // G4：滚动周期锚定 periodAnchor（订阅日/注册日），钳制漂移不会逐月后退
      const next = computePeriod(periodAnchor, current)
      periodStart = next.periodStart
      periodEnd = next.periodEnd
      await deps.users.setPeriod(userId, periodStart, periodEnd)
    }
    // G11：热路径无锁——周期内已有账目直接读余量；只有需要写 grant 才进锁
    let balanceMicros: number
    if (await deps.ledger.hasEntries(userId, periodStart)) {
      balanceMicros = await deps.ledger.balance(userId, periodStart)
    } else {
      balanceMicros = await deps.ledger.withUserLock(userId, async (ledger) => {
        // 锁内再查一次保证幂等：并发 getAccount 只写一条 grant
        if (await ledger.hasEntries(userId, periodStart)) {
          return ledger.balance(userId, periodStart)
        }
        const grant = await ledger.append({ userId, planId: null, runRef: null, kind: 'grant', deltaMicros: budgetMicros, periodStart })
        return grant.balanceAfter
      })
    }
    return {
      userId,
      tier,
      entitlements: TIER_ENTITLEMENTS[tier],
      isAdmin: user.isAdmin,
      periodStart,
      periodEnd: periodEnd as Date,
      budgetMicros,
      balanceMicros,
      remainingPercent: remainingPercent(balanceMicros, budgetMicros),
      runCapMicros: runCapMicros(tier),
    }
  }

  function canStartRun(account: BillingAccount): boolean {
    return account.isAdmin || account.balanceMicros >= RESERVE_MICROS[account.tier]
  }

  async function reserveRun(input: { account: BillingAccount; planId: string; runRef: string; force?: boolean }): Promise<ReserveResult> {
    const { account } = input
    if (account.isAdmin) return { ok: true }
    const amount = RESERVE_MICROS[account.tier]
    return deps.ledger.withUserLock(account.userId, async (ledger) => {
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
    // G5：非有限值（NaN/Infinity）按 0 结算，绝不让结算本身抛错
    const actual = Number.isFinite(input.actualMicros) ? Math.max(0, Math.round(input.actualMicros)) : 0
    const reserve = await deps.ledger.findOpenReserve(input.runRef)
    if (reserve) {
      const reserved = -reserve.deltaMicros
      const base = { userId: reserve.userId, planId: reserve.planId, runRef: reserve.runRef, periodStart: reserve.periodStart }
      // G5：结算全程持用户锁，锁内重新确认 reserve 仍 open（幂等）
      await deps.ledger.withUserLock(reserve.userId, async (ledger) => {
        if (!(await ledger.findOpenReserve(input.runRef))) return
        if (!input.hadModelOutput) {
          await ledger.append({ ...base, kind: 'refund', deltaMicros: reserved })
          return
        }
        // settle 的增量 = 预扣 − 实际：实际少于预扣补回差额，多于预扣继续扣（允许余量短暂为负）
        await ledger.append({ ...base, kind: 'settle', deltaMicros: reserved - actual })
      })
      return
    }
    // G1 兜底：reserve 已被孤儿退款误退（run 实际在跑且产生了输出），真实成本仍要入账，
    // 否则这半个多小时的模型与 Google 成本永久漏账
    const related = await deps.ledger.findByRunRef(input.runRef)
    const refunded = related.find((e) => e.kind === 'refund')
    if (refunded && input.hadModelOutput && actual > 0 && !related.some((e) => e.kind === 'settle')) {
      await deps.ledger.withUserLock(refunded.userId, async (ledger) => {
        const rows = await ledger.findByRunRef(input.runRef)
        if (rows.some((e) => e.kind === 'settle')) return
        await ledger.append({
          userId: refunded.userId,
          planId: refunded.planId,
          runRef: refunded.runRef,
          kind: 'settle',
          deltaMicros: -actual,
          periodStart: refunded.periodStart,
        })
      })
    }
  }

  async function chargeExtra(input: { runRef: string; micros: number }): Promise<void> {
    if (!Number.isFinite(input.micros) || input.micros <= 0) return
    const micros = Math.round(input.micros)
    const related = await deps.ledger.findByRunRef(input.runRef)
    const base = related[0]
    if (!base) return // 管理员/无预扣的 run：没有账目可挂，直接忽略
    await deps.ledger.withUserLock(base.userId, async (ledger) => {
      await ledger.append({
        userId: base.userId,
        planId: base.planId,
        runRef: base.runRef,
        kind: 'settle',
        deltaMicros: -micros,
        periodStart: base.periodStart,
      })
    })
  }

  async function refundStaleReserves(userId: string, olderThan: Date): Promise<void> {
    const stale = await deps.ledger.listOpenReserves(userId, olderThan)
    for (const reserve of stale) {
      // G1：run 还活着（token 仍匹配）绝不退——长 run 靠续租可以跑 13 分钟；
      // planId 为空（内部测试路径）视为不活跃
      if (reserve.planId && (await deps.isRunActive(reserve.planId, reserve.runRef ?? ''))) continue
      await deps.ledger.withUserLock(reserve.userId, async (ledger) => {
        if (!(await ledger.findOpenReserve(reserve.runRef ?? ''))) return
        await ledger.append({
          userId: reserve.userId,
          planId: reserve.planId,
          runRef: reserve.runRef,
          kind: 'refund',
          deltaMicros: -reserve.deltaMicros,
          periodStart: reserve.periodStart,
        })
      })
    }
  }

  return { getAccount, canStartRun, reserveRun, settleRun, chargeExtra, refundStaleReserves }
}
