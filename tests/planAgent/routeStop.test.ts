import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'
import { RUN_STOP_MARKER } from '@/lib/planAgent/stop'

/** 第十一轮 A3：POST /api/me/plans/:id/agent body { stop: true } 的两种返回 */

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(),
}))

import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { POST } from '@/app/api/me/plans/[id]/agent/route'

function makeDeps(repo: MemoryTripPlanRepo): TripPlanHandlerDeps {
  return { repo, getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }
}

async function beginRun(repo: MemoryTripPlanRepo, planId: string) {
  const begin = await repo.beginAgentRun({
    planId,
    userId: 'u1',
    content: { role: 'user', content: '帮我排一天' },
    since: new Date(0),
    limit: 10,
    busyTtlMs: 10 * 60 * 1000,
  })
  if (begin.status !== 'ok') throw new Error('unreachable')
  return begin
}

function stopRequest(planId: string) {
  return POST(
    new Request(`http://localhost/api/me/plans/${planId}/agent`, {
      method: 'POST',
      body: JSON.stringify({ stop: true }),
    }),
    { params: Promise.resolve({ id: planId }) },
  )
}

describe('agent route { stop: true }', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
  })

  it('当前无 run（agentBusy=false）→ { ok: true, stopped: false }', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await stopRequest(plan.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, stopped: false })
  })

  it('正在跑 → 调 stopAgentRun 返回 { ok: true, stopped: true }，busy 清空且停止标记落库', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginRun(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await stopRequest(plan.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, stopped: true })

    expect(await repo.isAgentBusy(plan.id)).toBe(false)
    expect(await repo.isAgentRunStopped(plan.id, begin.token)).toBe(true)
    const row = await repo.getRunLive(plan.id)
    expect(row?.statusText).toBe(RUN_STOP_MARKER)
  })

  it('H1：token 在、agentBusyUntil 已过期 → stopped:true 且 token 被清（不被 isAgentBusy 闸门挡住）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 租约已过期但 token 还在、loop 可能仍活着——isAgentBusy 对此返回 false，
    // 停止必须以 token 为准（stopAgentRun 原语），否则在跑的 run 停不下来
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: '帮我排一天' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: -1000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    expect(await repo.isAgentBusy(plan.id)).toBe(false)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await stopRequest(plan.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, stopped: true })

    expect((await repo.getPlan(plan.id))?.agentRunToken).toBeNull()
    expect(await repo.isAgentRunStopped(plan.id, begin.token)).toBe(true)
  })

  it('未登录与无权访问仍被挡在停止分支之前', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u2', title: '别人的计划' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue({ repo, getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) })

    const res = await stopRequest(plan.id)
    expect(res.status).toBe(403)
  })
})
