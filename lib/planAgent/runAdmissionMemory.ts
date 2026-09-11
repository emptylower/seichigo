import type { UsageLedgerRepo } from '@/lib/billing/ledger'
import { RESERVE_MICROS } from '@/lib/billing/priceTable'
import type { BillingAccount } from '@/lib/billing/service'
import type { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { AGENT_BUSY_TTL_MS } from './execute'
import type { RunAdmission } from './runAdmission'

/**
 * P0-B：Memory 版 runAdmission（vitest 用）。与 PrismaRunAdmission 的
 * 单事务语义对齐——单线程事件循环上"读状态 → 条件写"之间没有其它任务
 * 插队（Memory repo 各方法内部无 await 边界），等价于 Prisma 的单条条件
 * UPDATE；管理员豁免、runRef 幂等、金额表三处口径与 Prisma 实现逐字相同。
 */
export function createMemoryRunAdmission(deps: {
  repo: MemoryTripPlanRepo
  ledger: UsageLedgerRepo
  now?: () => Date
}): RunAdmission {
  const { repo, ledger } = deps
  const now = deps.now ?? (() => new Date())

  async function reserveForDispatch(input: {
    account: BillingAccount
    planId: string
    runToken: string
    busyTtlMs?: number
  }): Promise<{ ok: true; idempotent: boolean } | { ok: false; reason: 'token_gone' | 'insufficient' }> {
    const ttl = input.busyTtlMs ?? AGENT_BUSY_TTL_MS
    const at = now()
    // 条件核验：token 仍是本 run、未领取、租约未过期（Prisma 的 where 逐字段对齐）
    const state = await repo.getAgentRunState(input.planId)
    if (
      !state ||
      state.token !== input.runToken ||
      state.startedAt !== null ||
      !state.busyUntil ||
      state.busyUntil.getTime() <= at.getTime()
    ) {
      return { ok: false as const, reason: 'token_gone' as const }
    }
    // 只续租（renewAgentRun 内部再核 token 匹配）
    await repo.renewAgentRun(input.planId, input.runToken, ttl)
    if (input.account.isAdmin) return { ok: true as const, idempotent: false as const }
    if (await ledger.findOpenReserve(input.runToken)) return { ok: true as const, idempotent: true as const }
    await ledger.append({
      userId: input.account.userId,
      planId: input.planId,
      runRef: input.runToken,
      kind: 'reserve',
      deltaMicros: -RESERVE_MICROS[input.account.tier],
      periodStart: input.account.periodStart,
    })
    return { ok: true as const, idempotent: false as const }
  }

  async function revokeExpiredUnclaimed(input: {
    userId: string
    planId: string
    runToken: string
  }): Promise<{ revoked: boolean; refunded: boolean }> {
    const at = now()
    const state = await repo.getAgentRunState(input.planId)
    if (
      !state ||
      state.token !== input.runToken ||
      state.startedAt !== null ||
      !state.busyUntil ||
      state.busyUntil.getTime() >= at.getTime()
    ) {
      return { revoked: false as const, refunded: false as const }
    }
    // 条件清空（endAgentRun 内部核 token 匹配才清）
    await repo.endAgentRun(input.planId, input.runToken)
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
  }

  return { reserveForDispatch, revokeExpiredUnclaimed }
}
