import { prisma } from '@/lib/db/prisma'
import { PrismaUsageLedger } from '@/lib/billing/ledgerPrisma'
import { RESERVE_MICROS } from '@/lib/billing/priceTable'
import type { BillingAccount } from '@/lib/billing/service'
import type { Prisma } from '@prisma/client'
import type { BeginAgentRunInput, BeginAgentRunResult, TripPlanRepo } from '@/lib/tripPlan/repo'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'
import { AGENT_BUSY_TTL_MS } from './execute'

/**
 * P0-B（2026-09-11，联合方案 v1 不变量 2 与 5）：派发准入的事务协调模块。
 *
 * 预扣必须**同步**完成且先于任何派发——昨天把预扣挪到 202 之后异步做，
 * 派发一旦变成毫秒级，run 可能在预扣落账前结束（settleRun 找不到 reserve →
 * 成本漏记，随后落账的 reserve 变成孤儿占用余额）。
 *
 * 两个方法都自己开 `prisma.$transaction`，**锁顺序统一：用户 advisory lock
 * → TripPlan 行**（与 repoPrisma.beginAgentRun、ledgerPrisma.withUserLock
 * 一致），事务内同时做 TripPlan 条件更新与账本读写；绝不在事务里调用会
 * 另开事务的 service 方法（nested $transaction 会另起连接直接死锁）。
 */
export interface RunAdmission {
  /**
   * P2-A（2026-09-11）不变量 2 的合并实现：begin 与预扣同一事务——token 在此
   * 生成，"仍是本 run、未 claim、未过期"天然成立；管理员不记账；成功返回
   * begin 的结果（含 token）。quota_exceeded / busy 原样透传，不记账。
   * 预扣经 beginAgentRun 的 inTx 钩子落账：事务内、抢到 busy 位并落库
   * human 消息之后、提交之前；钩子抛错（账本故障）整体回滚——busy 位
   * 未占、human 消息未落库、无账目。POST 关键路径由此省掉整个第二事务。
   */
  beginAndReserve(input: BeginAgentRunInput & { account: BillingAccount }): Promise<BeginAgentRunResult>
  /**
   * 不变量 2：预扣成功先于派发。同一事务内：
   *  1) 用户锁；
   *  2) TripPlan 条件更新 `id AND agentRunToken=token AND agentRunStartedAt
   *     IS NULL AND agentBusyUntil > now`（data 只续租 agentBusyUntil）——
   *     影响 0 行 => token 已失效/已领取/已过期，返回 token_gone，不记账；
   *  3) 同 runRef 已有 open reserve 行 => 幂等返回 idempotent:true；
   *  4) 否则 append reserve（金额与 RESERVE_MICROS[tier] 一致；管理员直接
   *     ok 不记账，沿用 service.reserveRun 的豁免）。
   *
   * `insufficient`：非管理员且 balance < amount 且不 force 时才会出现——
   * 当前 POST 语义是 force（余量预检已在 canStartRun 做过，抢到 busy 位后
   * 无条件预扣、允许余量短暂为负），所以这个分支**今天不会触发**，仅为
   * 将来非 force 准入保留在类型里。
   *
   * P2-A：POST 已改走 beginAndReserve（预扣并入 begin 事务，token 不可能
   * 在同一事务里失效）；本方法保留给仍需"独立事务里按既有 token 补预扣"
   * 的调用方，当前生产路径无调用者（deprecated，不删）。
   */
  reserveForDispatch(input: {
    account: BillingAccount
    planId: string
    runToken: string
    /** 预扣成功后的续租 TTL；缺省 AGENT_BUSY_TTL_MS */
    busyTtlMs?: number
  }): Promise<{ ok: true; idempotent: boolean } | { ok: false; reason: 'token_gone' | 'insufficient' }>
  /**
   * 不变量 5：撤销过期且未 claim 的本 token 并退款其 open reserve，同一
   * 事务提交或回滚。条件更新 `id AND agentRunToken=token AND
   * agentRunStartedAt IS NULL AND agentBusyUntil < now` → 清 token/busy；
   * 0 行（已被 claim / 已换 token）=> 不退款，返回 revoked:false。
   * 幂等：没有 open reserve 就只撤销不退款。
   */
  revokeExpiredUnclaimed(input: {
    userId: string
    planId: string
    runToken: string
  }): Promise<{ revoked: boolean; refunded: boolean }>
}

export class PrismaRunAdmission implements RunAdmission {
  /** P2-A：beginAndReserve 复用仓储的 beginAgentRun（事务/锁序归它管） */
  constructor(private readonly repo: TripPlanRepo = new PrismaTripPlanRepo()) {}

  async beginAndReserve(input: BeginAgentRunInput & { account: BillingAccount }): Promise<BeginAgentRunResult> {
    const { account, ...beginInput } = input
    return this.repo.beginAgentRun({
      ...beginInput,
      // inTx 落点：begin 事务内、抢到 busy 位并落库 human 消息之后、提交之前。
      // 锁顺序不变（事务开头已是用户 advisory lock → TripPlan 行）；token 在
      // 此生成，"仍是本 run、未 claim、未过期"天然成立，无需二次核验。
      inTx: async (tx, ctx) => {
        // 管理员豁免（service.reserveRun 同款）：不记账直接放行
        if (account.isAdmin) return
        await new PrismaUsageLedger(tx as Prisma.TransactionClient).append({
          userId: account.userId,
          planId: beginInput.planId,
          runRef: ctx.token,
          kind: 'reserve',
          deltaMicros: -RESERVE_MICROS[account.tier],
          periodStart: account.periodStart,
        })
      },
    })
  }

  async reserveForDispatch(input: {
    account: BillingAccount
    planId: string
    runToken: string
    busyTtlMs?: number
  }): Promise<{ ok: true; idempotent: boolean } | { ok: false; reason: 'token_gone' | 'insufficient' }> {
    const ttl = input.busyTtlMs ?? AGENT_BUSY_TTL_MS
    return prisma.$transaction(
      async (tx) => {
        // 锁顺序与 beginAgentRun / withUserLock 一致：先取用户级 advisory lock。
        // ::text 强转是必须的：advisory lock 函数返回 void，Prisma 无法反序列化
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.account.userId}))::text`
        const now = new Date()
        // TripPlan 条件更新：token 仍是本 run、未被领取、租约未过期——0 行即
        // token_gone（不派发；调用方绝不 endAgentRun 别人的 run）
        const renewed = await tx.tripPlan.updateMany({
          where: {
            id: input.planId,
            agentRunToken: input.runToken,
            agentRunStartedAt: null,
            agentBusyUntil: { gt: now },
          },
          data: { agentBusyUntil: new Date(now.getTime() + ttl) },
        })
        if (renewed.count === 0) return { ok: false as const, reason: 'token_gone' as const }
        // 管理员豁免（service.reserveRun 同款）：不记账直接放行
        if (input.account.isAdmin) return { ok: true as const, idempotent: false as const }
        const ledger = new PrismaUsageLedger(tx)
        // 幂等：同 runRef 已有 open reserve（极端重试窗口）不重复入账
        if (await ledger.findOpenReserve(input.runToken)) return { ok: true as const, idempotent: true as const }
        // force 语义：不做余量检查（canStartRun 已预检），允许余量短暂为负
        await ledger.append({
          userId: input.account.userId,
          planId: input.planId,
          runRef: input.runToken,
          kind: 'reserve',
          deltaMicros: -RESERVE_MICROS[input.account.tier],
          periodStart: input.account.periodStart,
        })
        return { ok: true as const, idempotent: false as const }
      },
      { maxWait: 10_000, timeout: 15_000 },
    )
  }

  async revokeExpiredUnclaimed(input: {
    userId: string
    planId: string
    runToken: string
  }): Promise<{ revoked: boolean; refunded: boolean }> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))::text`
        const now = new Date()
        // 条件清空：token 匹配、从未领取、租约已过期才动；0 行（已被 claim /
        // 已被接管 / 已被撤销）=> 不退款
        const cleared = await tx.tripPlan.updateMany({
          where: {
            id: input.planId,
            agentRunToken: input.runToken,
            agentRunStartedAt: null,
            agentBusyUntil: { lt: now },
          },
          data: { agentBusyUntil: null, agentRunToken: null },
        })
        if (cleared.count === 0) return { revoked: false as const, refunded: false as const }
        const ledger = new PrismaUsageLedger(tx)
        const reserve = await ledger.findOpenReserve(input.runToken)
        if (!reserve) return { revoked: true as const, refunded: false as const }
        await ledger.append({
          userId: reserve.userId,
          planId: reserve.planId,
          runRef: reserve.runRef,
          kind: 'refund',
          deltaMicros: -reserve.deltaMicros,
          periodStart: reserve.periodStart,
        })
        return { revoked: true as const, refunded: true as const }
      },
      { maxWait: 10_000, timeout: 15_000 },
    )
  }
}

let cached: RunAdmission | null = null

export function getRunAdmission(): RunAdmission {
  if (!cached) cached = new PrismaRunAdmission()
  return cached
}
