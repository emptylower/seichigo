import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { MemoryUsageLedger } from '@/lib/billing/ledgerMemory'
import { createMemoryRunAdmission } from '@/lib/planAgent/runAdmissionMemory'
import { RESERVE_MICROS } from '@/lib/billing/priceTable'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'
import type { BillingAccount } from '@/lib/billing/service'

/**
 * P0-B（2026-09-11）：runAdmission 的 Memory 全覆盖——不变量 2（同步幂等
 * 预扣先于派发）与不变量 5（过期未 claim 的撤销 + 退款同事务）。
 * Prisma 实现与 Memory 逐字段对齐（锁序 / 条件 / 金额 / 豁免），生产路径
 * 行为由路由测试经 Memory 版驱动。
 */

const PERIOD_START = new Date('2026-09-01T00:00:00Z')

function makeAccount(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    userId: 'u1',
    tier: 'free',
    entitlements: TIER_ENTITLEMENTS.free,
    isAdmin: false,
    periodStart: PERIOD_START,
    periodEnd: new Date('2026-09-30T00:00:00Z'),
    budgetMicros: 1_000_000,
    balanceMicros: 1_000_000,
    remainingPercent: 100,
    runCapMicros: 500_000,
    ...overrides,
  }
}

async function setup(options: { busyTtlMs?: number } = {}) {
  const repo = new MemoryTripPlanRepo()
  const ledger = new MemoryUsageLedger()
  const admission = createMemoryRunAdmission({ repo, ledger })
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const begin = await repo.beginAgentRun({
    planId: plan.id,
    userId: 'u1',
    content: { role: 'user', content: 'hi' },
    since: new Date(0),
    limit: 10,
    busyTtlMs: options.busyTtlMs ?? 60_000,
  })
  if (begin.status !== 'ok') throw new Error(`beginAgentRun status: ${begin.status}`)
  return { repo, ledger, admission, planId: plan.id, runToken: begin.token }
}

describe('reserveForDispatch（不变量 2）', () => {
  it('正常路径 → ok 且入账一条 -RESERVE_MICROS[tier] 的 reserve', async () => {
    const { ledger, admission, planId, runToken } = await setup()
    const account = makeAccount({ tier: 'standard' })
    const res = await admission.reserveForDispatch({ account, planId, runToken })
    expect(res).toEqual({ ok: true, idempotent: false })
    const rows = await ledger.findByRunRef(runToken)
    expect(rows.filter((r) => r.kind === 'reserve')).toHaveLength(1)
    expect(rows[0]!.deltaMicros).toBe(-RESERVE_MICROS.standard)
    expect(rows[0]!.planId).toBe(planId)
    // 成功预扣同步完成：调用返回时账本里已可见（不依赖响应后任务）
    expect(await ledger.balance('u1', PERIOD_START)).toBe(-RESERVE_MICROS.standard)
  })

  it('同 runRef 两次 → 只有一条 reserve 行，第二次 idempotent:true', async () => {
    const { ledger, admission, planId, runToken } = await setup()
    const account = makeAccount()
    expect(await admission.reserveForDispatch({ account, planId, runToken })).toEqual({
      ok: true,
      idempotent: false,
    })
    expect(await admission.reserveForDispatch({ account, planId, runToken })).toEqual({
      ok: true,
      idempotent: true,
    })
    const rows = await ledger.findByRunRef(runToken)
    expect(rows.filter((r) => r.kind === 'reserve')).toHaveLength(1)
  })

  it('token 已被领取（claimAgentRun 先行）→ token_gone 且零账目', async () => {
    const { repo, ledger, admission, planId, runToken } = await setup()
    expect(await repo.claimAgentRun(planId, runToken, 60_000)).toEqual({ userId: 'u1' })
    const res = await admission.reserveForDispatch({ account: makeAccount(), planId, runToken })
    expect(res).toEqual({ ok: false, reason: 'token_gone' })
    expect(await ledger.findByRunRef(runToken)).toHaveLength(0)
  })

  it('token 已过期（busyUntil < now）→ token_gone 且零账目', async () => {
    const { ledger, admission, planId, runToken } = await setup({ busyTtlMs: -1000 })
    const res = await admission.reserveForDispatch({ account: makeAccount(), planId, runToken })
    expect(res).toEqual({ ok: false, reason: 'token_gone' })
    expect(await ledger.findByRunRef(runToken)).toHaveLength(0)
  })

  it('token 已被换掉（过期后新 run 接管）→ token_gone', async () => {
    const { repo, admission, planId, runToken } = await setup({ busyTtlMs: -1000 })
    // 旧租约过期后被新请求接管（beginAgentRun 抢占写新 token）
    const takeover = await repo.beginAgentRun({
      planId,
      userId: 'u1',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    if (takeover.status !== 'ok') throw new Error('takeover failed')
    expect(takeover.token).not.toBe(runToken)
    // 旧 token 仍带在消息里重放：条件更新核 token 匹配 → 拒绝
    const res = await admission.reserveForDispatch({ account: makeAccount(), planId, runToken })
    expect(res).toEqual({ ok: false, reason: 'token_gone' })
  })

  it('管理员 → ok 不记账（沿用 service.reserveRun 豁免）', async () => {
    const { ledger, admission, planId, runToken } = await setup()
    const res = await admission.reserveForDispatch({ account: makeAccount({ isAdmin: true }), planId, runToken })
    expect(res).toEqual({ ok: true, idempotent: false })
    expect(await ledger.findByRunRef(runToken)).toHaveLength(0)
    expect(await ledger.hasEntries('u1', PERIOD_START)).toBe(false)
  })

  it('余额不足也放行（force 语义：预检在 canStartRun，预扣不因余量失败）', async () => {
    const { ledger, admission, planId, runToken } = await setup()
    const res = await admission.reserveForDispatch({
      account: makeAccount({ balanceMicros: 0 }),
      planId,
      runToken,
    })
    expect(res).toEqual({ ok: true, idempotent: false })
    expect(await ledger.balance('u1', PERIOD_START)).toBe(-RESERVE_MICROS.free)
  })
})

describe('revokeExpiredUnclaimed（不变量 5）', () => {
  it('过期未 claim + open reserve → 清 token/busy + 一条 refund，余额恢复', async () => {
    const { repo, ledger, admission, planId, runToken } = await setup({ busyTtlMs: -1000 })
    await ledger.append({
      userId: 'u1',
      planId,
      runRef: runToken,
      kind: 'reserve',
      deltaMicros: -RESERVE_MICROS.free,
      periodStart: PERIOD_START,
    })
    const res = await admission.revokeExpiredUnclaimed({ userId: 'u1', planId, runToken })
    expect(res).toEqual({ revoked: true, refunded: true })
    expect(await repo.getAgentRunState(planId)).toBeNull()
    const rows = await ledger.findByRunRef(runToken)
    expect(rows.map((r) => r.kind)).toEqual(['reserve', 'refund'])
    expect(rows[1]!.deltaMicros).toBe(RESERVE_MICROS.free)
    expect(await ledger.balance('u1', PERIOD_START)).toBe(0)
  })

  it('已被 claim → revoked:false 且不退款（claim 续租后租约未过期，条件不满足）', async () => {
    const { repo, ledger, admission, planId, runToken } = await setup({ busyTtlMs: -1000 })
    await ledger.append({
      userId: 'u1',
      planId,
      runRef: runToken,
      kind: 'reserve',
      deltaMicros: -RESERVE_MICROS.free,
      periodStart: PERIOD_START,
    })
    expect(await repo.claimAgentRun(planId, runToken, 60_000)).toEqual({ userId: 'u1' })
    const res = await admission.revokeExpiredUnclaimed({ userId: 'u1', planId, runToken })
    expect(res).toEqual({ revoked: false, refunded: false })
    expect(await repo.getAgentRunState(planId)).not.toBeNull()
    expect((await ledger.findByRunRef(runToken)).map((r) => r.kind)).toEqual(['reserve'])
  })

  it('过期未 claim 但没有 reserve → revoked:true, refunded:false', async () => {
    const { repo, admission, planId, runToken } = await setup({ busyTtlMs: -1000 })
    const res = await admission.revokeExpiredUnclaimed({ userId: 'u1', planId, runToken })
    expect(res).toEqual({ revoked: true, refunded: false })
    expect(await repo.getAgentRunState(planId)).toBeNull()
  })

  it('同一输入调两次 → 第二次 revoked:false（token 已清），refund 只有一条', async () => {
    const { repo, ledger, admission, planId, runToken } = await setup({ busyTtlMs: -1000 })
    await ledger.append({
      userId: 'u1',
      planId,
      runRef: runToken,
      kind: 'reserve',
      deltaMicros: -RESERVE_MICROS.free,
      periodStart: PERIOD_START,
    })
    expect(await admission.revokeExpiredUnclaimed({ userId: 'u1', planId, runToken })).toEqual({
      revoked: true,
      refunded: true,
    })
    expect(await admission.revokeExpiredUnclaimed({ userId: 'u1', planId, runToken })).toEqual({
      revoked: false,
      refunded: false,
    })
    expect((await ledger.findByRunRef(runToken)).filter((r) => r.kind === 'refund')).toHaveLength(1)
    expect(await repo.getAgentRunState(planId)).toBeNull()
  })

  it('token 不匹配（消息重放别人的 token）→ revoked:false', async () => {
    const { admission, planId, runToken } = await setup({ busyTtlMs: -1000 })
    const res = await admission.revokeExpiredUnclaimed({ userId: 'u1', planId, runToken: 'not-mine' })
    expect(res).toEqual({ revoked: false, refunded: false })
  })
})
