import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

/**
 * Task A7：agent route 按 deps.getLocale 解析站点语言——错误响应用
 * serverText 字典，runPlanAgent 收到 locale。
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

vi.mock('@/lib/billing/serverDeps', async () => {
  const { createBillingService } = await import('@/lib/billing/service')
  const { MemoryUsageLedger } = await import('@/lib/billing/ledgerMemory')
  const { MemoryBillingUsers } = await import('@/lib/billing/usersMemory')
  const users = new MemoryBillingUsers()
  users.seed({ id: 'u1', tier: 'standard', periodStart: new Date('2026-08-20T00:00:00Z'), periodAnchor: new Date('2026-08-20T00:00:00Z'), periodEnd: null, isAdmin: true })
  const billing = createBillingService({ ledger: new MemoryUsageLedger(), users, isRunActive: async () => false })
  return { getBillingService: () => billing }
})

import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { runPlanAgent } from '@/lib/planAgent/loop'
import { POST } from '@/app/api/me/plans/[id]/agent/route'
import type { SupportedLocale } from '@/lib/i18n/types'

const getLocaleEn = vi.fn(async (): Promise<SupportedLocale> => 'en')

function makeDeps(repo: MemoryTripPlanRepo, overrides?: Partial<TripPlanHandlerDeps>): TripPlanHandlerDeps {
  return {
    repo,
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    getLocale: getLocaleEn,
    ...overrides,
  }
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

describe('agent route locale', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.mocked(runPlanAgent).mockClear()
  })

  it('deps.getLocale=en 时未登录错误为英文', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(
      makeDeps(repo, { getSession: vi.fn().mockResolvedValue(null) }),
    )

    const res = await agentRequest(plan.id, { message: 'hi' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Please sign in' })
  })

  it('deps.getLocale=en 时 runPlanAgent 收到 locale=en，quota/busy 错误为英文', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await agentRequest(plan.id, { message: 'plan a trip' })
    expect(res.status).toBe(200)
    await res.text() // 排空 SSE 流，让 stream.start() 内的调用完成

    expect(vi.mocked(runPlanAgent)).toHaveBeenCalledTimes(1)
    const deps = vi.mocked(runPlanAgent).mock.calls[0][0] as { locale?: string }
    expect(deps.locale).toBe('en')
  })

  it('空消息错误走字典（en）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await agentRequest(plan.id, {})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Message cannot be empty' })
  })
})
