import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

/**
 * Task A3（§0.3）：POST /api/me/plans/:id/agent 在有 PLAN_AGENT_QUEUE 绑定时
 * 投递队列并返回 202；send 抛错回落内联 SSE；无绑定走现有 SSE。
 */

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(),
}))

vi.mock('@/lib/planAgent/loop', () => ({
  runPlanAgent: vi.fn(async () => {}),
}))

vi.mock('@/lib/planAgent/api', () => ({
  createChatCompletion: vi.fn(),
  generatePlanTitle: vi.fn(async () => null),
  withModelUsageInRunLog: vi.fn((repo: unknown) => repo),
}))

vi.mock('@/lib/planAgent/serverDeps', () => ({
  getPlanAgentServerDeps: vi.fn(() => ({})),
  runInBackground: vi.fn(),
}))

vi.mock('@/lib/planAgent/execute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/planAgent/execute')>()
  return { ...actual, executePlanAgentRun: vi.fn(actual.executePlanAgentRun) }
})

vi.mock('@/lib/billing/serverDeps', async () => {
  const { createBillingService } = await import('@/lib/billing/service')
  const { MemoryUsageLedger } = await import('@/lib/billing/ledgerMemory')
  const { MemoryBillingUsers } = await import('@/lib/billing/usersMemory')
  const users = new MemoryBillingUsers()
  users.seed({ id: 'u1', tier: 'standard', periodStart: new Date('2026-08-20T00:00:00Z'), periodAnchor: new Date('2026-08-20T00:00:00Z'), periodEnd: null, isAdmin: true })
  const billing = createBillingService({ ledger: new MemoryUsageLedger(), users, isRunActive: async () => false })
  const holder: { current: unknown } = { current: billing }
  return {
    getBillingService: () => holder.current,
    __setBillingService: (next: unknown) => {
      holder.current = next
    },
    __resetBillingService: () => {
      holder.current = billing
    },
  }
})

vi.mock('@/lib/anitabi/cf/bindings', () => ({
  getCfBindings: vi.fn((): null => null),
}))

import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { runPlanAgent } from '@/lib/planAgent/loop'
import { executePlanAgentRun } from '@/lib/planAgent/execute'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import * as billingServerDeps from '@/lib/billing/serverDeps'
import { runCapMicros } from '@/lib/billing/budget'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'
import { isPlanAgentQueueMessage } from '@/lib/planAgent/queueMessage'
import { POST } from '@/app/api/me/plans/[id]/agent/route'
import { POST as POSTInternalRun } from '@/app/api/internal/plan-agent/run/route'

// vi.mock 工厂里的测试辅助导出不在真实模块类型上，经断言取用
const { __setBillingService, __resetBillingService } = billingServerDeps as unknown as {
  __setBillingService: (next: unknown) => void
  __resetBillingService: () => void
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

describe('agent route 队列投递（Task A3）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.mocked(runPlanAgent).mockClear()
    vi.mocked(executePlanAgentRun).mockClear()
    vi.mocked(getCfBindings).mockReset()
    vi.mocked(getCfBindings).mockReturnValue(null)
    __resetBillingService()
  })

  afterEach(() => {
    vi.mocked(getCfBindings).mockReturnValue(null)
    vi.unstubAllEnvs()
  })

  it('有队列绑定 → 202 { queued, runToken }，send 收到完整消息体，human 已落库且 busy', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const send = vi.fn(async () => undefined)
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)

    const res = await agentRequest(plan.id, { message: 'plan a trip' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true, runToken: expect.any(String) })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      v: 1,
      planId: plan.id,
      runToken: expect.any(String),
      locale: 'zh',
      message: 'plan a trip',
      resume: false,
      enqueuedAt: expect.any(String),
      tier: 'standard',
    })
    // human 消息已落库、busy 为 true（run 交给队列消费者）
    expect((await repo.listMessages(plan.id)).map((m) => m.kind)).toEqual(['human'])
    expect(await repo.isAgentBusy(plan.id)).toBe(true)
    // SSE 内联路径未启动
    expect(vi.mocked(runPlanAgent)).not.toHaveBeenCalled()
  })

  it('resume 回合 → message 为 null、resume 为 true', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 先造一个"上次被打断"的状态：human 消息之后没有任何运行日志
    await repo.appendMessage(plan.id, 'human', { role: 'user', content: '帮我排一天' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const send = vi.fn(async () => undefined)
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)

    const res = await agentRequest(plan.id, { resume: true })
    expect(res.status).toBe(202)
    expect(send).toHaveBeenCalledWith({
      v: 1,
      planId: plan.id,
      runToken: expect.any(String),
      locale: 'zh',
      message: null,
      resume: true,
      enqueuedAt: expect.any(String),
      tier: 'standard',
    })
    // resume 不追加 human 消息
    expect((await repo.listMessages(plan.id))).toHaveLength(1)
  })

  it('结构化回答 → 投递前直写 answerMetaPatch（不依赖 SSE 路径）', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const send = vi.fn(async () => undefined)
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)

    const res = await agentRequest(plan.id, {
      message: '就这两天出发',
      answerTo: 'ask-1',
      answerValue: { startDate: '2026-10-01', dayCount: 2 },
    })
    expect(res.status).toBe(202)
    const after = await repo.getPlan(plan.id)
    expect(after?.startDate?.toISOString().slice(0, 10)).toBe('2026-10-01')
    expect(after?.dayCount).toBe(2)
  })

  it('send 抛错 → console.warn 并回落内联 SSE（text/event-stream）', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const send = vi.fn(async () => {
      throw new Error('queue unavailable')
    })
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await agentRequest(plan.id, { message: 'plan a trip' })
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    await res.text() // 排空 SSE，让 stream.start() 完成
    expect(warn).toHaveBeenCalledWith('[planAgent/queue] send failed, falling back to inline SSE', expect.any(Error))
    warn.mockRestore()
    // 回落路径照常跑完并释放 busy
    expect(await repo.isAgentBusy(plan.id)).toBe(false)
  })

  it('绑定存在但开关未开（预览 --var 覆盖为 0）→ 现有 SSE 路径，不投递', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '0')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const send = vi.fn(async () => undefined)
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)

    const res = await agentRequest(plan.id, { message: 'plan a trip' })
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    await res.text()
    expect(send).not.toHaveBeenCalled()
    expect(vi.mocked(runPlanAgent)).toHaveBeenCalledTimes(1)
  })

  it('无绑定（next dev / vitest）→ 现有 SSE 路径原样', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await agentRequest(plan.id, { message: 'plan a trip' })
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    await res.text()
    expect(vi.mocked(runPlanAgent)).toHaveBeenCalledTimes(1)
  })
})

describe('internal run route 计费装配（G3 fail-closed）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.mocked(executePlanAgentRun).mockClear()
    __resetBillingService()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    __resetBillingService()
  })

  it('getAccount 抛错 → 回落免费档能力表传给 executePlanAgentRun', async () => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', 's3cret')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: 'hi' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    expect(begin.status).toBe('ok')
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    __setBillingService({
      getAccount: async () => {
        throw new Error('db down')
      },
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await POSTInternalRun(
        new Request('http://localhost/api/internal/plan-agent/run', {
          method: 'POST',
          headers: { 'x-plan-agent-secret': 's3cret' },
          body: JSON.stringify({
            v: 1,
            planId: plan.id,
            runToken: begin.status === 'ok' ? begin.token : '',
            locale: 'zh',
            message: 'hi',
            resume: false,
            enqueuedAt: new Date().toISOString(),
          }),
        }),
      )
      await res.text()
      expect(vi.mocked(executePlanAgentRun)).toHaveBeenCalledTimes(1)
      const arg = vi.mocked(executePlanAgentRun).mock.calls[0]![0] as {
        billing?: { entitlements: { tier: string }; runCapMicros: number }
      }
      expect(arg.billing?.entitlements.tier).toBe('free')
      expect(arg.billing?.runCapMicros).toBe(runCapMicros('free'))
      expect(errorLog).toHaveBeenCalledWith('[api/internal/plan-agent/run] getAccount failed, falling back to free entitlements', expect.any(Error))
    } finally {
      errorLog.mockRestore()
    }
  })
})

describe('isPlanAgentQueueMessage 对 tier 字段容错（CUT-2）', () => {
  const base = {
    v: 1,
    planId: 'p1',
    runToken: 'tok',
    locale: 'zh',
    message: 'hi',
    resume: false,
    enqueuedAt: new Date('2026-09-10T00:00:00Z').toISOString(),
  }

  // 滚动部署窗口内在途消息不带 tier；将来加第 4 档时旧消费者会收到不认识的
  // tier。校验器若因此拒信 → 内部路由 400 → 消费者无条件 ack() 销毁消息，
  // human 消息已落库 + busy 占 90s，用户只能靠 TTL 过期找回——绝不能拒。
  it.each([
    ['undefined（旧版在途消息）', undefined],
    ['team（未来档位滚动窗口）', 'team'],
    ['null', null],
    ['123', 123],
    ['Pro（大小写不符）', 'Pro'],
  ])('tier=%s 不导致校验失败', (_label, tier) => {
    expect(isPlanAgentQueueMessage({ ...base, tier })).toBe(true)
  })
})

describe('internal run route tier 透传（CUT-2）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.mocked(executePlanAgentRun).mockClear()
    __resetBillingService()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    __resetBillingService()
  })

  async function setupAgentRun(): Promise<{ planId: string; runToken: string }> {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: 'hi' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    if (begin.status !== 'ok') throw new Error(`beginAgentRun status: ${begin.status}`)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    return { planId: plan.id, runToken: begin.token }
  }

  async function postInternalRun(body: Record<string, unknown>): Promise<void> {
    const res = await POSTInternalRun(
      new Request('http://localhost/api/internal/plan-agent/run', {
        method: 'POST',
        headers: { 'x-plan-agent-secret': 's3cret' },
        body: JSON.stringify(body),
      }),
    )
    await res.text()
  }

  function billingOfCall(): { entitlements: typeof TIER_ENTITLEMENTS.free; runCapMicros: number } {
    const arg = vi.mocked(executePlanAgentRun).mock.calls[0]![0] as {
      billing?: { entitlements: typeof TIER_ENTITLEMENTS.free; runCapMicros: number }
    }
    if (!arg.billing) throw new Error('executePlanAgentRun called without billing')
    return arg.billing
  }

  it("tier='pro' 且 enqueuedAt 新鲜 → getAccount 一次都不调，按 pro 能力表装配", async () => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', 's3cret')
    const { planId, runToken } = await setupAgentRun()
    const getAccount = vi.fn(async () => {
      throw new Error('passthrough must skip getAccount')
    })
    __setBillingService({ getAccount })

    await postInternalRun({
      v: 1,
      planId,
      runToken,
      locale: 'zh',
      message: 'hi',
      resume: false,
      enqueuedAt: new Date().toISOString(),
      tier: 'pro',
    })

    expect(getAccount).not.toHaveBeenCalled()
    expect(vi.mocked(executePlanAgentRun)).toHaveBeenCalledTimes(1)
    const billing = billingOfCall()
    expect(billing.entitlements).toEqual(TIER_ENTITLEMENTS.pro)
    expect(billing.runCapMicros).toBe(runCapMicros('pro'))
  })

  it('tier 缺失 → 走 getAccount 三读，装配其返回值（绝不落 free）', async () => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', 's3cret')
    const { planId, runToken } = await setupAgentRun()
    const getAccount = vi.fn(async () => ({
      userId: 'u1',
      entitlements: TIER_ENTITLEMENTS.pro,
      runCapMicros: runCapMicros('pro'),
    }))
    __setBillingService({ getAccount })

    await postInternalRun({
      v: 1,
      planId,
      runToken,
      locale: 'zh',
      message: 'hi',
      resume: false,
      enqueuedAt: new Date().toISOString(),
    })

    expect(getAccount).toHaveBeenCalledTimes(1)
    expect(getAccount).toHaveBeenCalledWith('u1')
    const billing = billingOfCall()
    expect(billing.entitlements).toEqual(TIER_ENTITLEMENTS.pro)
    expect(billing.runCapMicros).toBe(runCapMicros('pro'))
  })

  it("tier='team'（不认识）→ 同缺失一样走 getAccount", async () => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', 's3cret')
    const { planId, runToken } = await setupAgentRun()
    const getAccount = vi.fn(async () => ({
      userId: 'u1',
      entitlements: TIER_ENTITLEMENTS.pro,
      runCapMicros: runCapMicros('pro'),
    }))
    __setBillingService({ getAccount })

    await postInternalRun({
      v: 1,
      planId,
      runToken,
      locale: 'zh',
      message: 'hi',
      resume: false,
      enqueuedAt: new Date().toISOString(),
      tier: 'team',
    })

    expect(getAccount).toHaveBeenCalledTimes(1)
    const billing = billingOfCall()
    expect(billing.entitlements).toEqual(TIER_ENTITLEMENTS.pro)
    expect(billing.runCapMicros).toBe(runCapMicros('pro'))
  })

  it('enqueuedAt 超过 TIER_PASSTHROUGH_MAX_AGE_MS → 走 getAccount', async () => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', 's3cret')
    const { planId, runToken } = await setupAgentRun()
    const getAccount = vi.fn(async () => ({
      userId: 'u1',
      entitlements: TIER_ENTITLEMENTS.pro,
      runCapMicros: runCapMicros('pro'),
    }))
    __setBillingService({ getAccount })

    await postInternalRun({
      v: 1,
      planId,
      runToken,
      locale: 'zh',
      message: 'hi',
      resume: false,
      enqueuedAt: new Date(Date.now() - 130_000).toISOString(),
      tier: 'pro',
    })

    expect(getAccount).toHaveBeenCalledTimes(1)
    const billing = billingOfCall()
    expect(billing.entitlements).toEqual(TIER_ENTITLEMENTS.pro)
  })

  it("PLAN_AGENT_TIER_PASSTHROUGH='0'（回滚开关）→ 走 getAccount", async () => {
    vi.stubEnv('PLAN_AGENT_INTERNAL_SECRET', 's3cret')
    vi.stubEnv('PLAN_AGENT_TIER_PASSTHROUGH', '0')
    const { planId, runToken } = await setupAgentRun()
    const getAccount = vi.fn(async () => ({
      userId: 'u1',
      entitlements: TIER_ENTITLEMENTS.pro,
      runCapMicros: runCapMicros('pro'),
    }))
    __setBillingService({ getAccount })

    await postInternalRun({
      v: 1,
      planId,
      runToken,
      locale: 'zh',
      message: 'hi',
      resume: false,
      enqueuedAt: new Date().toISOString(),
      tier: 'pro',
    })

    expect(getAccount).toHaveBeenCalledTimes(1)
    const billing = billingOfCall()
    expect(billing.entitlements).toEqual(TIER_ENTITLEMENTS.pro)
  })
})

describe('A 部分：POST 关键路径瘦身（waitUntil / 并行读 / 预扣不阻塞 202）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.mocked(runPlanAgent).mockClear()
    vi.mocked(executePlanAgentRun).mockClear()
    vi.mocked(getCfBindings).mockReset()
    vi.mocked(getCfBindings).mockReturnValue(null)
    __resetBillingService()
  })

  afterEach(() => {
    vi.mocked(getCfBindings).mockReturnValue(null)
    vi.unstubAllEnvs()
    __resetBillingService()
  })

  /** route 只透传 entitlements/runCapMicros、402 分支读 tier/periodEnd——最小形状即可 */
  function makeAccount(overrides: { balanceMicros?: number } = {}) {
    return {
      userId: 'u1',
      tier: 'free',
      entitlements: { tier: 'free' },
      isAdmin: false,
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-09-20T00:00:00Z'),
      budgetMicros: 1_000_000,
      balanceMicros: 1_000_000,
      remainingPercent: 100,
      runCapMicros: 500,
      ...overrides,
    }
  }

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('有 CF context：清扫与预扣都经 waitUntil、不阻塞 202；预扣在 send 之后以 runToken 入账', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const account = makeAccount()
    const refund = deferred<void>()
    const refundStaleReserves = vi.fn(() => refund.promise)
    const reserve = deferred<void>()
    const reserveRun = vi.fn(() => reserve.promise)
    __setBillingService({
      refundStaleReserves,
      getAccount: vi.fn(async () => account),
      canStartRun: () => true,
      reserveRun,
    })
    let reserveCallsWhenSendFinished = -1
    const send = vi.fn(async () => {
      reserveCallsWhenSendFinished = reserveRun.mock.calls.length
    })
    const waitUntil = vi.fn()
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
      ctx: { waitUntil },
    } as ReturnType<typeof getCfBindings>)

    // 两个 deferred 都 pending：202 仍立即返回（清扫与预扣都没阻塞响应）
    const res = await agentRequest(plan.id, { message: 'hi' })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { runToken: string }

    expect(refundStaleReserves).toHaveBeenCalledWith('u1', expect.any(Date))
    // 预扣发生在投递之后（send 完成时还没发起），且已以 runRef=runToken 发起
    expect(reserveCallsWhenSendFinished).toBe(0)
    expect(reserveRun).toHaveBeenCalledTimes(1)
    expect(reserveRun).toHaveBeenCalledWith({ account, planId: plan.id, runRef: body.runToken, force: true })
    // 清扫与预扣两个任务都交给了 waitUntil（响应后由 runtime 兜底执行）
    expect(waitUntil).toHaveBeenCalledTimes(2)
    refund.resolve()
    reserve.resolve()
    await Promise.all(waitUntil.mock.calls.map((call) => call[0]))
  })

  it('拿不到 CF context：清扫与预扣逐个回落同步 await——resolve 之前 POST 不返回（不静默丢弃）', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const account = makeAccount()
    const refund = deferred<void>()
    const refundStaleReserves = vi.fn(() => refund.promise)
    const reserve = deferred<void>()
    const reserveRun = vi.fn(() => reserve.promise)
    __setBillingService({
      refundStaleReserves,
      getAccount: vi.fn(async () => account),
      canStartRun: () => true,
      reserveRun,
    })
    const send = vi.fn(async () => undefined)
    // 有队列绑定但没有 ctx.waitUntil（next dev / vitest 的典型形状）
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)

    let settled = false
    const resPromise = agentRequest(plan.id, { message: 'hi' }).then((r) => {
      settled = true
      return r
    })
    // 清扫未 resolve：POST 卡在同步 await 上，不返回
    await vi.waitFor(() => expect(refundStaleReserves).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
    refund.resolve()
    // 预扣同样被同步 await
    await vi.waitFor(() => expect(reserveRun).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
    reserve.resolve()

    const res = await resPromise
    expect(res.status).toBe(202)
    const body = (await res.json()) as { runToken: string }
    expect(reserveRun).toHaveBeenCalledWith({ account, planId: plan.id, runRef: body.runToken, force: true })
  })

  it('getPlan/getAccount 并行后拒绝优先级不变：getAccount 抛错时 404/403 仍按归属判定而非 500', async () => {
    const repo = new MemoryTripPlanRepo()
    const otherPlan = await repo.createPlan({ userId: 'someone-else', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    __setBillingService({
      refundStaleReserves: vi.fn(async () => {}),
      getAccount: vi.fn(async () => {
        throw new Error('db down')
      }),
      canStartRun: () => true,
      reserveRun: vi.fn(async () => ({ ok: true })),
    })

    const notFound = await agentRequest('no-such-plan', { message: 'hi' })
    expect(notFound.status).toBe(404)
    const forbidden = await agentRequest(otherPlan.id, { message: 'hi' })
    expect(forbidden.status).toBe(403)
  })

  it('402 预检语义不变且仍在 beginAgentRun 之前：拒绝时不落人类消息、不置 busy、不预扣', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const account = makeAccount({ balanceMicros: 0 })
    const reserveRun = vi.fn(async () => ({ ok: true as const }))
    __setBillingService({
      refundStaleReserves: vi.fn(async () => {}),
      getAccount: vi.fn(async () => account),
      canStartRun: () => false,
      reserveRun,
    })

    const res = await agentRequest(plan.id, { message: 'hi' })
    expect(res.status).toBe(402)
    const body = (await res.json()) as { code: string; resetsAt: string; upgradeAvailable: boolean }
    expect(body.code).toBe('budget_exhausted')
    expect(body.resetsAt).toBe(account.periodEnd.toISOString())
    expect(body.upgradeAvailable).toBe(true)
    // 预检在 beginAgentRun 之前：超额请求不落库人类消息、不抢 busy、不预扣
    expect(await repo.listMessages(plan.id)).toHaveLength(0)
    expect(await repo.isAgentBusy(plan.id)).toBe(false)
    expect(reserveRun).not.toHaveBeenCalled()
  })

  it('send 抛错回落内联 SSE：预扣仍同步发生（run 开烧前落账）、busy 照常释放', async () => {
    vi.stubEnv('PLAN_AGENT_QUEUE_ENABLED', '1')
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const account = makeAccount()
    const reserveRun = vi.fn(async () => ({ ok: true as const }))
    __setBillingService({
      refundStaleReserves: vi.fn(async () => {}),
      getAccount: vi.fn(async () => account),
      canStartRun: () => true,
      reserveRun,
    })
    const send = vi.fn(async () => {
      throw new Error('queue unavailable')
    })
    vi.mocked(getCfBindings).mockReturnValue({
      env: { PLAN_AGENT_QUEUE: { send } },
    } as ReturnType<typeof getCfBindings>)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const res = await agentRequest(plan.id, { message: 'hi' })
      expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
      await res.text() // 排空 SSE，让 stream.start() 与 finally 释放跑完
      expect(reserveRun).toHaveBeenCalledTimes(1)
      expect(reserveRun).toHaveBeenCalledWith(
        expect.objectContaining({ planId: plan.id, runRef: expect.any(String), force: true }),
      )
      expect(await repo.isAgentBusy(plan.id)).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })
})
