import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'

/**
 * P0-A（2026-09-11）联合方案 v1 不变量 1：一个 token 至多领取成功一次。
 * Memory 侧语义 + Prisma 侧的 where/data 落库形状（mock prisma，同
 * stopAgentRun.prisma.test.ts 模式）。
 */

describe('MemoryTripPlanRepo.claimAgentRun / getAgentRunState（P0-A）', () => {
  it('同 token 两次领取：第一次返回 owner 且 startedAt 被写；第二次返回 null 且 busyUntil 不变', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-11T00:00:00.000Z'))
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

      const first = await repo.claimAgentRun(plan.id, begin.token, 60_000)
      expect(first).toEqual({ userId: 'u1' })
      const state = await repo.getAgentRunState(plan.id)
      expect(state?.token).toBe(begin.token)
      expect(state?.startedAt).toEqual(new Date('2026-09-11T00:00:00.000Z'))
      expect(state?.busyUntil).toEqual(new Date('2026-09-11T00:01:00.000Z'))

      // 第二个消费者（Queue at-least-once 重投）拿同一条消息：领取失败，
      // 且不碰第一个消费者写下的租约
      vi.setSystemTime(new Date('2026-09-11T00:00:30.000Z'))
      const second = await repo.claimAgentRun(plan.id, begin.token, 60_000)
      expect(second).toBeNull()
      const after = await repo.getAgentRunState(plan.id)
      expect(after?.startedAt).toEqual(new Date('2026-09-11T00:00:00.000Z'))
      expect(after?.busyUntil).toEqual(new Date('2026-09-11T00:01:00.000Z'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('token 不符（无 run / 被接管）→ null 且不写', async () => {
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

    expect(await repo.claimAgentRun(plan.id, 'wrong-token', 60_000)).toBeNull()
    const state = await repo.getAgentRunState(plan.id)
    expect(state?.startedAt).toBeNull()
    expect(await repo.claimAgentRun('plan-missing', begin.token, 60_000)).toBeNull()
  })

  it('beginAgentRun 拿新 token 后 startedAt 重置为 null（可再次 claim）；endAgentRun 后 getAgentRunState 为 null', async () => {
    vi.useFakeTimers()
    try {
      const repo = new MemoryTripPlanRepo()
      const plan = await repo.createPlan({ userId: 'u1', title: 't' })
      const first = await repo.beginAgentRun({
        planId: plan.id,
        userId: 'u1',
        content: null,
        since: new Date(0),
        limit: 10,
        busyTtlMs: 60_000,
      })
      if (first.status !== 'ok') throw new Error('unreachable')
      expect(await repo.claimAgentRun(plan.id, first.token, 60_000)).toEqual({ userId: 'u1' })

      await repo.endAgentRun(plan.id, first.token)
      expect(await repo.getAgentRunState(plan.id)).toBeNull()

      // 新 run：新 token 必然重置 startedAt——领取机会从零开始
      const second = await repo.beginAgentRun({
        planId: plan.id,
        userId: 'u1',
        content: null,
        since: new Date(0),
        limit: 10,
        busyTtlMs: 60_000,
      })
      if (second.status !== 'ok') throw new Error('unreachable')
      expect((await repo.getAgentRunState(plan.id))?.startedAt).toBeNull()
      expect(await repo.claimAgentRun(plan.id, second.token, 60_000)).toEqual({ userId: 'u1' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('renewAgentRun 在 startedAt 非空时仍成功（不变量 1：领取后的执行者自己能续租）', async () => {
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
    expect(await repo.claimAgentRun(plan.id, begin.token, 60_000)).toEqual({ userId: 'u1' })
    expect((await repo.getAgentRunState(plan.id))?.startedAt).not.toBeNull()

    const before = (await repo.getAgentRunState(plan.id))!.busyUntil!.getTime()
    expect(await repo.renewAgentRun(plan.id, begin.token, 300_000)).toBe(true)
    expect((await repo.getAgentRunState(plan.id))!.busyUntil!.getTime()).toBeGreaterThan(before)
  })
})

vi.mock('@/lib/db/prisma', () => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? arg : (arg as (t: unknown) => Promise<unknown>)(prisma),
    ),
    $queryRaw: vi.fn(async () => []),
    tripPlanMessage: {
      count: vi.fn(async () => 0),
      create: vi.fn(async () => ({ id: 'msg-1', planId: 'plan-1', kind: 'human', content: null, createdAt: new Date() })),
    },
    tripPlan: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      updateManyAndReturn: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
  }
  return { prisma }
})

import { prisma } from '@/lib/db/prisma'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'

const mocked = prisma as unknown as {
  tripPlan: { updateMany: Mock; updateManyAndReturn: Mock; findUnique: Mock }
}

describe('PrismaTripPlanRepo.claimAgentRun / getAgentRunState（P0-A）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.tripPlan.updateMany.mockResolvedValue({ count: 1 })
    mocked.tripPlan.updateManyAndReturn.mockResolvedValue([])
    mocked.tripPlan.findUnique.mockResolvedValue(null)
  })

  it('claimAgentRun：单条条件 UPDATE——where 同时要求 token 匹配且 startedAt 为空，data 写 startedAt+续租，select 只取 userId', async () => {
    mocked.tripPlan.updateManyAndReturn.mockResolvedValue([{ userId: 'owner-u1' }])
    const repo = new PrismaTripPlanRepo()

    expect(await repo.claimAgentRun('plan-1', 'run-1', 90_000)).toEqual({ userId: 'owner-u1' })
    const args = mocked.tripPlan.updateManyAndReturn.mock.calls[0]![0] as {
      where: Record<string, unknown>
      data: Record<string, Date>
      select: Record<string, boolean>
    }
    expect(args.where).toEqual({ id: 'plan-1', agentRunToken: 'run-1', agentRunStartedAt: null })
    expect(args.data.agentRunStartedAt).toEqual(expect.any(Date))
    expect(args.data.agentBusyUntil).toEqual(expect.any(Date))
    expect(args.select).toEqual({ userId: true })
  })

  it('claimAgentRun：0 行命中（token 失效/已被领取/计划不存在）→ null', async () => {
    const repo = new PrismaTripPlanRepo()
    expect(await repo.claimAgentRun('plan-1', 'run-1', 90_000)).toBeNull()
  })

  it('beginAgentRun：抢占 busy 位时同时重置 agentRunStartedAt=null（新 token 的领取机会从零开始）', async () => {
    const repo = new PrismaTripPlanRepo()
    const begin = await repo.beginAgentRun({
      planId: 'plan-1',
      userId: 'u1',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    expect(begin.status).toBe('ok')
    const args = mocked.tripPlan.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(args.data.agentRunStartedAt).toBeNull()
  })

  it('getAgentRunState：无行或无 token → null；有 token → 透传 busyUntil/startedAt', async () => {
    const repo = new PrismaTripPlanRepo()

    mocked.tripPlan.findUnique.mockResolvedValue(null)
    expect(await repo.getAgentRunState('plan-1')).toBeNull()

    mocked.tripPlan.findUnique.mockResolvedValue({
      agentRunToken: null,
      agentBusyUntil: new Date(),
      agentRunStartedAt: null,
    })
    expect(await repo.getAgentRunState('plan-1')).toBeNull()

    const busyUntil = new Date('2026-09-11T00:01:00.000Z')
    const startedAt = new Date('2026-09-11T00:00:00.000Z')
    mocked.tripPlan.findUnique.mockResolvedValue({ agentRunToken: 'run-1', agentBusyUntil: busyUntil, agentRunStartedAt: startedAt })
    expect(await repo.getAgentRunState('plan-1')).toEqual({ token: 'run-1', busyUntil, startedAt })
    const args = mocked.tripPlan.findUnique.mock.calls[0]![0] as { select: Record<string, boolean> }
    expect(args.select).toEqual({ agentRunToken: true, agentBusyUntil: true, agentRunStartedAt: true })
  })
})
