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
