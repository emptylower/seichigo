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

describe('MemoryTripPlanRepo.getPlanAdmission / beginAgentRun inTx（P2-A）', () => {
  it('getPlanAdmission：存在 → 归属 + 派生的租约到期；不存在 → null', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    expect(await repo.getPlanAdmission(plan.id)).toEqual({ userId: 'u1', agentBusyUntil: null })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    const admission = await repo.getPlanAdmission(plan.id)
    expect(admission?.userId).toBe('u1')
    expect(admission?.agentBusyUntil).toEqual(expect.any(Date))
    expect(admission!.agentBusyUntil!.getTime()).toBeGreaterThan(Date.now())
    expect(await repo.getPlanAdmission('no-such-plan')).toBeNull()
  })

  it('beginAgentRun inTx 抛错 → 回滚：busy 位恢复原状、human 消息未落库', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 预置一个已过期的旧租约（接管前的真实前置状态）
    const prior = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: -1000,
    })
    if (prior.status !== 'ok') throw new Error('unreachable')

    await expect(
      repo.beginAgentRun({
        planId: plan.id,
        userId: 'u1',
        content: { role: 'user', content: 'hi' },
        since: new Date(0),
        limit: 10,
        busyTtlMs: 60_000,
        inTx: async () => {
          throw new Error('reserve failed')
        },
      }),
    ).rejects.toThrow('reserve failed')

    // 与 Prisma 事务回滚同语义：新 busy 位未占、human 消息未落库、旧（过期）状态原样
    expect(await repo.getAgentRunState(plan.id)).toMatchObject({ token: prior.token })
    expect(await repo.isAgentBusy(plan.id)).toBe(false)
    expect(await repo.listMessages(plan.id)).toHaveLength(0)
  })

  it('beginAgentRun inTx 正常返回 → 消息照常落库且 token 即返回值', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const seenTokens: string[] = []
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: 'hi' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
      inTx: async (_tx, ctx) => {
        seenTokens.push(ctx.token)
      },
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    expect(seenTokens).toEqual([begin.token])
    expect((await repo.listMessages(plan.id)).map((m) => m.kind)).toEqual(['human'])
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
  tripPlanMessage: { count: Mock; create: Mock }
}

describe('PrismaTripPlanRepo.claimAgentRun / getAgentRunState（P0-A）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.tripPlan.updateMany.mockResolvedValue({ count: 1 })
    mocked.tripPlan.updateManyAndReturn.mockResolvedValue([])
    mocked.tripPlan.findUnique.mockResolvedValue(null)
    mocked.tripPlanMessage.count.mockResolvedValue(0)
    mocked.tripPlanMessage.create.mockResolvedValue({
      id: 'msg-1',
      planId: 'plan-1',
      kind: 'human',
      content: null,
      createdAt: new Date(),
    })
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

  it('getPlanAdmission（P2-A）：单条 findUnique 只取 userId/agentBusyUntil；无行 → null', async () => {
    const repo = new PrismaTripPlanRepo()
    const busyUntil = new Date('2026-09-11T00:01:00.000Z')
    mocked.tripPlan.findUnique.mockResolvedValue({ userId: 'owner-u1', agentBusyUntil: busyUntil })
    expect(await repo.getPlanAdmission('plan-1')).toEqual({ userId: 'owner-u1', agentBusyUntil: busyUntil })
    const args = mocked.tripPlan.findUnique.mock.calls[0]![0] as { select: Record<string, boolean> }
    expect(args.select).toEqual({ userId: true, agentBusyUntil: true })
    mocked.tripPlan.findUnique.mockResolvedValue(null)
    expect(await repo.getPlanAdmission('plan-1')).toBeNull()
  })

  it('beginAgentRun inTx（P2-A）：busy 抢占与消息落库之后、返回之前调用，tx 原样传入，ctx.token 即结果 token', async () => {
    const repo = new PrismaTripPlanRepo()
    const order: string[] = []
    mocked.tripPlan.updateMany.mockImplementation(async () => {
      order.push('claim')
      return { count: 1 }
    })
    mocked.tripPlanMessage.create.mockImplementation(async () => {
      order.push('message')
      return { id: 'msg-1', planId: 'plan-1', kind: 'human', content: null, createdAt: new Date() }
    })
    const inTx = vi.fn(async (_tx: unknown, _ctx: { token: string }) => {
      order.push('inTx')
    })
    const begin = await repo.beginAgentRun({
      planId: 'plan-1',
      userId: 'u1',
      content: { role: 'user', content: 'hi' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
      inTx,
    })
    expect(begin.status).toBe('ok')
    if (begin.status !== 'ok') throw new Error('unreachable')
    expect(order).toEqual(['claim', 'message', 'inTx'])
    // $transaction mock 直接把 prisma 作为 tx 传入——断言原样透传
    expect(inTx.mock.calls[0]![0]).toBe(prisma)
    expect(inTx.mock.calls[0]![1]).toEqual({ token: begin.token })
  })

  it('beginAgentRun inTx 抛错（P2-A）→ 异常冒泡（真实实现即整个事务回滚）；quota_exceeded/busy 分支不调用 inTx', async () => {
    const repo = new PrismaTripPlanRepo()
    await expect(
      repo.beginAgentRun({
        planId: 'plan-1',
        userId: 'u1',
        content: null,
        since: new Date(0),
        limit: 10,
        busyTtlMs: 60_000,
        inTx: async () => {
          throw new Error('reserve failed')
        },
      }),
    ).rejects.toThrow('reserve failed')

    // quota_exceeded：count 命中上限 → 透传，inTx 不被调用
    const quotaTx = vi.fn(async () => {})
    mocked.tripPlanMessage.count.mockResolvedValue(10)
    const quota = await repo.beginAgentRun({
      planId: 'plan-1',
      userId: 'u1',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
      inTx: quotaTx,
    })
    expect(quota).toEqual({ status: 'quota_exceeded' })
    expect(quotaTx).not.toHaveBeenCalled()

    // busy：updateMany 命中 0 行 → 透传，inTx 不被调用
    mocked.tripPlanMessage.count.mockResolvedValue(0)
    mocked.tripPlan.updateMany.mockResolvedValue({ count: 0 })
    const busyTx = vi.fn(async () => {})
    const busy = await repo.beginAgentRun({
      planId: 'plan-1',
      userId: 'u1',
      content: null,
      since: new Date(0),
      limit: 10,
      busyTtlMs: 60_000,
      inTx: busyTx,
    })
    expect(busy).toEqual({ status: 'busy' })
    expect(busyTx).not.toHaveBeenCalled()
  })
})
