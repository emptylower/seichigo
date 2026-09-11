import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

/**
 * Task A3（§0.2）：内部执行路由 /api/internal/plan-agent/run——密钥校验
 * （503/401）、stale token 跳过、正常路径调用 executePlanAgentRun 且响应体
 * 含 done。
 */

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(),
}))

vi.mock('@/lib/planAgent/execute', () => ({
  executePlanAgentRun: vi.fn(async () => {}),
  AGENT_BUSY_TTL_MS: 90 * 1000,
}))

// CUT-1：计费装配改由 owner.userId 推出——mock 掉 billing 服务才能断言
// getAccount 收到的 userId。默认 getAccount → null（触发 free 兜底路径）。
vi.mock('@/lib/billing/serverDeps', () => ({
  getBillingService: vi.fn(() => ({
    getAccount: vi.fn(async () => null),
  })),
}))

import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { getBillingService } from '@/lib/billing/serverDeps'
import { executePlanAgentRun } from '@/lib/planAgent/execute'
import { POST } from '@/app/api/internal/plan-agent/run/route'

function makeDeps(repo: MemoryTripPlanRepo): TripPlanHandlerDeps {
  return { repo, getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }
}

/** billing 服务 mock 默认实现：getAccount → null（路由走 free 兜底） */
function freeFallbackBilling() {
  return { getAccount: vi.fn(async () => null) } as unknown as ReturnType<typeof getBillingService>
}

function internalRequest(body: unknown, secret = 'test-secret') {
  return POST(
    new Request('http://localhost/api/internal/plan-agent/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-plan-agent-secret': secret },
      body: JSON.stringify(body),
    }),
  )
}

function queueMessage(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    planId: 'plan-1',
    runToken: 'run-1',
    locale: 'zh',
    message: '帮我排一天',
    resume: false,
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('内部执行路由 /api/internal/plan-agent/run（Task A3）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.mocked(executePlanAgentRun).mockClear()
    vi.mocked(getBillingService).mockReset().mockImplementation(freeFallbackBilling)
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', 'test-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未配置密钥 → 503', async () => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', '')
    const res = await internalRequest(queueMessage())
    expect(res.status).toBe(503)
  })

  it('密钥错误 → 401', async () => {
    const res = await internalRequest(queueMessage(), 'wrong-secret')
    expect(res.status).toBe(401)
  })

  it('消息体不合法 → 400，不触碰执行器', async () => {
    const repo = new MemoryTripPlanRepo()
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await internalRequest({ v: 2, planId: 'plan-1' })
    expect(res.status).toBe(400)
    expect(vi.mocked(executePlanAgentRun)).not.toHaveBeenCalled()
  })

  it('token 已不符（无 run / 被接管）→ { skipped: "stale_token" }，不跑执行器', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await internalRequest(queueMessage({ planId: plan.id, runToken: 'stale' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'stale_token' })
    expect(vi.mocked(executePlanAgentRun)).not.toHaveBeenCalled()
  })

  it('计划不存在 → 与 token 不符完全相同的响应体与 status（CUT-1：两分支统一由 0 行命中产生）', async () => {
    const repo = new MemoryTripPlanRepo()
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await internalRequest(queueMessage({ planId: 'plan-missing', runToken: 'whatever' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'stale_token' })
    expect(vi.mocked(executePlanAgentRun)).not.toHaveBeenCalled()
  })

  it('正常路径：renewAgentRun 通过 → 调用 executePlanAgentRun（含软截止）且响应体含 done', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: '帮我排一天' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const before = Date.now()
    const res = await internalRequest(queueMessage({ planId: plan.id, runToken: begin.token }))
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toContain('done')
    expect(text).not.toContain('skipped')

    expect(vi.mocked(executePlanAgentRun)).toHaveBeenCalledTimes(1)
    const input = vi.mocked(executePlanAgentRun).mock.calls[0][0]
    expect(input.planId).toBe(plan.id)
    expect(input.runToken).toBe(begin.token)
    expect(input.locale).toBe('zh')
    expect(input.message).toBe('帮我排一天')
    expect(input.resume).toBe(false)
    expect(input.deadlineAt).toBeGreaterThanOrEqual(before + 13 * 60_000)
    expect(input.deadlineAt).toBeLessThanOrEqual(Date.now() + 13 * 60_000)
  })

  it('P0-A 不变量 1：同 token 两次 POST——第一次跑执行器，第二次 { skipped: "stale_token" } 且不再跑（Queue at-least-once 重投）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: '帮我排一天' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const first = await internalRequest(queueMessage({ planId: plan.id, runToken: begin.token }))
    await first.text()
    expect(vi.mocked(executePlanAgentRun)).toHaveBeenCalledTimes(1)

    // 重投的同一条消息：token 仍有效，但已被第一个消费者领取——不再执行
    const second = await internalRequest(queueMessage({ planId: plan.id, runToken: begin.token }))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ skipped: 'stale_token' })
    expect(vi.mocked(executePlanAgentRun)).toHaveBeenCalledTimes(1)
  })

  it('续跑轮消息（message=null、resume=true）→ 传给执行器 message="" resume=true', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await internalRequest(queueMessage({ planId: plan.id, runToken: begin.token, message: null, resume: true }))
    expect((await res.text()).replace('done\n', '')).toBe('')
    const input = vi.mocked(executePlanAgentRun).mock.calls[0][0]
    expect(input.message).toBe('')
    expect(input.resume).toBe(true)
  })

  it('正常路径：billing 由 owner.userId 推出（getAccount 收到计划归属用户，entitlements 原样透传）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'owner-u7', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'owner-u7',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const getAccount = vi.fn(async () => ({ entitlements: { marker: 'ent-pro' }, runCapMicros: 424_242 }))
    vi.mocked(getBillingService).mockImplementation(
      () => ({ getAccount }) as unknown as ReturnType<typeof getBillingService>,
    )

    const res = await internalRequest(queueMessage({ planId: plan.id, runToken: begin.token }))
    await res.text()

    expect(getAccount).toHaveBeenCalledWith('owner-u7')
    const input = vi.mocked(executePlanAgentRun).mock.calls[0][0]
    expect(input.billing).toEqual({ entitlements: { marker: 'ent-pro' }, runCapMicros: 424_242 })
  })

  it('MemoryTripPlanRepo.renewAgentRunOwner 与 renewAgentRun 语义逐字对齐：token 不符时不写 agentBusyUntil', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'owner-u9', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'owner-u9',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: 1_000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    const before = (await repo.getPlan(plan.id))!.agentBusyUntil!.getTime()

    expect(await repo.renewAgentRunOwner(plan.id, 'wrong-token', 60_000)).toBeNull()
    expect((await repo.getPlan(plan.id))!.agentBusyUntil!.getTime()).toBe(before)

    expect(await repo.renewAgentRunOwner(plan.id, begin.token, 60_000)).toEqual({ userId: 'owner-u9' })
    expect((await repo.getPlan(plan.id))!.agentBusyUntil!.getTime()).toBeGreaterThan(before)
  })
})
