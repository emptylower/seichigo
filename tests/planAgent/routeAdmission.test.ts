import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { MemoryUsageLedger } from '@/lib/billing/ledgerMemory'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'
import { RESERVE_MICROS } from '@/lib/billing/priceTable'
import { createMemoryRunAdmission } from '@/lib/planAgent/runAdmissionMemory'

/**
 * P0-B（2026-09-11）：POST /api/me/plans/:id/agent 的准入层——暂停开关、
 * token_gone 拒派发、上一轮过期未 claim 的先撤销退款再开始。
 */

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(),
}))

vi.mock('@/lib/planAgent/loop', () => ({
  runPlanAgent: vi.fn(async () => {}),
}))

vi.mock('@/lib/planAgent/execute', () => ({
  executePlanAgentRun: vi.fn(async () => {}),
  AGENT_BUSY_TTL_MS: 90 * 1000,
}))

vi.mock('@/lib/billing/serverDeps', () => ({
  getBillingService: vi.fn(),
}))

vi.mock('@/lib/anitabi/cf/bindings', () => ({
  getCfBindings: vi.fn((): null => null),
}))

// 路由只消费 getRunAdmission；可控 holder 让单测注入 Memory 版或 stub
vi.mock('@/lib/planAgent/runAdmission', () => {
  const permissive = {
    reserveForDispatch: vi.fn(async () => ({ ok: true as const, idempotent: false })),
    revokeExpiredUnclaimed: vi.fn(async () => ({ revoked: false, refunded: false })),
  }
  const holder: { current: unknown } = { current: null }
  return {
    getRunAdmission: () => holder.current ?? permissive,
    __setRunAdmission: (next: unknown) => {
      holder.current = next
    },
    __resetRunAdmission: () => {
      holder.current = null
    },
  }
})

import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { getBillingService } from '@/lib/billing/serverDeps'
import { executePlanAgentRun } from '@/lib/planAgent/execute'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import * as admissionModule from '@/lib/planAgent/runAdmission'
import { POST } from '@/app/api/me/plans/[id]/agent/route'

const { __setRunAdmission, __resetRunAdmission } = admissionModule as unknown as {
  __setRunAdmission: (next: unknown) => void
  __resetRunAdmission: () => void
}

const PERIOD_START = new Date('2026-09-01T00:00:00Z')

function makeAccount() {
  return {
    userId: 'u1',
    tier: 'free' as const,
    entitlements: { tier: 'free' as const },
    isAdmin: false,
    periodStart: PERIOD_START,
    periodEnd: new Date('2026-09-30T00:00:00Z'),
    budgetMicros: 1_000_000,
    balanceMicros: 1_000_000,
    remainingPercent: 100,
    runCapMicros: 500,
  }
}

function makeDeps(repo: MemoryTripPlanRepo): TripPlanHandlerDeps {
  return { repo, getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }
}

function agentRequest(planId: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/me/plans/${planId}/agent`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: planId }) },
  )
}

describe('agent route 准入层（P0-B）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.mocked(executePlanAgentRun).mockClear()
    vi.mocked(getCfBindings).mockReset()
    vi.mocked(getCfBindings).mockReturnValue(null)
    vi.mocked(getBillingService).mockReset()
    __resetRunAdmission()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    __resetRunAdmission()
    vi.mocked(getCfBindings).mockReturnValue(null)
  })

  it('PLAN_AGENT_STARTS_PAUSED=1 → 503 starts_paused，不 beginAgentRun（无消息、不 busy）', async () => {
    vi.stubEnv('PLAN_AGENT_STARTS_PAUSED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    vi.mocked(getBillingService).mockReturnValue({
      getAccount: vi.fn(async () => makeAccount()),
      refundStaleReserves: vi.fn(async () => {}),
      canStartRun: () => true,
    } as unknown as ReturnType<typeof getBillingService>)

    const res = await agentRequest(plan.id, { message: 'hi' })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'starts_paused', error: expect.any(String) })
    // 不抢 busy 位、不落人类消息、不跑执行器
    expect(await repo.isAgentBusy(plan.id)).toBe(false)
    expect(await repo.listMessages(plan.id)).toHaveLength(0)
    expect(vi.mocked(executePlanAgentRun)).not.toHaveBeenCalled()
  })

  it('暂停开关不影响 stop 分支：paused=1 时 { stop:true } 仍 200', async () => {
    vi.stubEnv('PLAN_AGENT_STARTS_PAUSED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    vi.mocked(getBillingService).mockReturnValue({
      getAccount: vi.fn(async () => makeAccount()),
      refundStaleReserves: vi.fn(async () => {}),
      canStartRun: () => true,
    } as unknown as ReturnType<typeof getBillingService>)

    const res = await agentRequest(plan.id, { stop: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, stopped: false })
  })

  it('reserveForDispatch token_gone → 409，不投队列、不进内联、不 endAgentRun 别人的 run', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    vi.mocked(getBillingService).mockReturnValue({
      getAccount: vi.fn(async () => makeAccount()),
      refundStaleReserves: vi.fn(async () => {}),
      canStartRun: () => true,
    } as unknown as ReturnType<typeof getBillingService>)
    const send = vi.fn(async () => undefined)
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    __setRunAdmission({
      reserveForDispatch: vi.fn(async () => ({ ok: false as const, reason: 'token_gone' as const })),
      revokeExpiredUnclaimed: vi.fn(async () => ({ revoked: false, refunded: false })),
    })
    const endSpy = vi.spyOn(repo, 'endAgentRun')

    const res = await agentRequest(plan.id, { message: 'hi' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: expect.any(String) })
    expect(send).not.toHaveBeenCalled()
    expect(vi.mocked(executePlanAgentRun)).not.toHaveBeenCalled()
    expect(endSpy).not.toHaveBeenCalled()
  })

  it('上一轮 token 过期未 claim（有 open reserve）→ 本次 POST 先 revoke+refund 再 begin，202 且新 run 已预扣', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    const repo = new MemoryTripPlanRepo()
    const ledger = new MemoryUsageLedger()
    const admission = createMemoryRunAdmission({ repo, ledger })
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const prior = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: '上一轮' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: -1000,
    })
    if (prior.status !== 'ok') throw new Error('unreachable')
    await ledger.append({
      userId: 'u1',
      planId: plan.id,
      runRef: prior.token,
      kind: 'reserve',
      deltaMicros: -RESERVE_MICROS.free,
      periodStart: PERIOD_START,
    })
    const revokeSpy = vi.spyOn(admission, 'revokeExpiredUnclaimed')
    __setRunAdmission(admission)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    vi.mocked(getBillingService).mockReturnValue({
      getAccount: vi.fn(async () => makeAccount()),
      refundStaleReserves: vi.fn(async () => {}),
      canStartRun: () => true,
    } as unknown as ReturnType<typeof getBillingService>)
    const send = vi.fn(async (_msg: unknown) => undefined)
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)

    const res = await agentRequest(plan.id, { message: '新一轮' })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { runToken: string }
    expect(body.runToken).not.toBe(prior.token)

    // 先撤销退款再 begin：旧 token 清空、旧 reserve 已退
    expect(revokeSpy).toHaveBeenCalledWith({ userId: 'u1', planId: plan.id, runToken: prior.token })
    expect(await repo.getAgentRunState(plan.id)).toMatchObject({ token: body.runToken, startedAt: null })
    const priorRows = await ledger.findByRunRef(prior.token)
    expect(priorRows.map((r) => r.kind)).toEqual(['reserve', 'refund'])
    // 新 run 同步预扣 + 派发载荷带 dispatchedAt
    expect(await ledger.findOpenReserve(body.runToken)).not.toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]![0] as { dispatchedAt?: string }
    expect(typeof payload.dispatchedAt).toBe('string')
  })
})
