import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'
import type { BeginAgentRunInput } from '@/lib/tripPlan/repo'

/**
 * P0-A（2026-09-11）不变量 3：内联 SSE 路径的一次性领取——claim 失败
 * （同 token 已被别的执行者领取）的 loser 没有执行副作用：不预扣、不跑
 * 执行器、不进无条件 endAgentRun 的 finally，按已排队语义返回 202。
 */

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(),
}))

vi.mock('@/lib/planAgent/execute', () => ({
  executePlanAgentRun: vi.fn(async () => {}),
  AGENT_BUSY_TTL_MS: 90 * 1000,
}))

vi.mock('@/lib/billing/serverDeps', () => ({
  getBillingService: vi.fn(),
}))

// P0-B：预扣改走 admission（同步、先于派发）——permissive stub 即可，
// 本文件只断言 claim loser 没有执行副作用。
// P2-A：起步改走 beginAndReserve——permissive 版委托 deps.repo 真实 begin
vi.mock('@/lib/planAgent/runAdmission', () => ({
  getRunAdmission: () => ({
    beginAndReserve: vi.fn(async (input: BeginAgentRunInput & { account?: unknown }) => {
      const { getTripPlanApiDeps } = await import('@/lib/tripPlan/api')
      const deps = await getTripPlanApiDeps()
      const { account: _account, ...begin } = input
      return deps.repo.beginAgentRun(begin)
    }),
    reserveForDispatch: vi.fn(async () => ({ ok: true as const, idempotent: false })),
    revokeExpiredUnclaimed: vi.fn(async () => ({ revoked: false, refunded: false })),
  }),
}))

vi.mock('@/lib/anitabi/cf/bindings', () => ({
  getCfBindings: vi.fn((): null => null),
}))

import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { getBillingService } from '@/lib/billing/serverDeps'
import { executePlanAgentRun } from '@/lib/planAgent/execute'
import { POST } from '@/app/api/me/plans/[id]/agent/route'

function agentRequest(planId: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/me/plans/${planId}/agent`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: planId }) },
  )
}

describe('agent route 内联路径一次性领取（P0-A）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.mocked(executePlanAgentRun).mockClear()
    vi.mocked(getBillingService).mockReset()
  })

  it('claim 失败 → 202 { queued: true, runToken }，不预扣、不跑执行器、不 endAgentRun', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const reserveRun = vi.fn(async () => ({ ok: true as const }))
    vi.mocked(getBillingService).mockReturnValue(
      {
        getAccount: vi.fn(async () => ({
          userId: 'u1',
          tier: 'free',
          entitlements: { tier: 'free' },
          periodStart: new Date('2026-09-01T00:00:00Z'),
          periodEnd: new Date('2026-09-20T00:00:00Z'),
          runCapMicros: 500,
        })),
        refundStaleReserves: vi.fn(async () => {}),
        canStartRun: () => true,
        reserveRun,
      } as unknown as ReturnType<typeof getBillingService>,
    )
    // 模拟"同 token 已被别的执行者领取"（Queue 重投后第一个消费者已 claim，
    // 本请求回落内联路径）：beginAgentRun 抢到的新 token 在 claim 处落空
    const deps: TripPlanHandlerDeps = {
      repo,
      getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    }
    deps.repo.claimAgentRun = vi.fn(async () => null)
    const endSpy = vi.spyOn(repo, 'endAgentRun')
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(deps)

    const res = await agentRequest(plan.id, { message: 'hi' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true, runToken: expect.any(String) })

    // loser 没有任何执行副作用
    expect(reserveRun).not.toHaveBeenCalled()
    expect(vi.mocked(executePlanAgentRun)).not.toHaveBeenCalled()
    expect(endSpy).not.toHaveBeenCalled()
  })
})
