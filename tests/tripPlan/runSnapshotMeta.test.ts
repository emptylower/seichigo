import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { composePlanRevision } from '@/lib/tripPlan/repo'

/**
 * 2026-09-06 §0.6.1：getRunSnapshotMeta——观察流每 500 ms 读一次的轻量快照。
 * memory 与 prisma（mock findUnique）实现的同语义测试。
 */

vi.mock('@/lib/db/prisma', () => {
  const prisma = {
    tripPlan: {
      findUnique: vi.fn(async () => null),
    },
  }
  return { prisma }
})

import { prisma } from '@/lib/db/prisma'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'

const mockedFindUnique = prisma.tripPlan.findUnique as unknown as Mock

function beginBusy(repo: MemoryTripPlanRepo, planId: string) {
  return repo.beginAgentRun({
    planId,
    userId: 'u1',
    content: { role: 'user', content: '帮我排一天' },
    since: new Date(0),
    limit: 10,
    busyTtlMs: 60_000,
  })
}

describe('MemoryTripPlanRepo.getRunSnapshotMeta', () => {
  it('计划不存在 → null', async () => {
    const repo = new MemoryTripPlanRepo()
    expect(await repo.getRunSnapshotMeta('nope')).toBeNull()
  })

  it('空闲计划：agentBusy=false、live=null、消息计数与时间戳正确、planRevision 与展示字段对应', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await repo.appendMessage(plan.id, 'human', { role: 'user', content: '第一条' })

    const snap = await repo.getRunSnapshotMeta(plan.id)
    expect(snap).not.toBeNull()
    expect(snap!.agentBusy).toBe(false)
    expect(snap!.live).toBeNull()
    expect(snap!.messageCount).toBe(1)
    expect(snap!.lastMessageAt).toBeInstanceOf(Date)
    const planRow = await repo.getPlan(plan.id)
    expect(snap!.planRevision).toBe(
      composePlanRevision({
        title: planRow!.title,
        status: planRow!.status,
        startDate: planRow!.startDate,
        dayCount: planRow!.dayCount,
        bangumiIds: planRow!.bangumiIds,
        stage: planRow!.stage,
        dayTotal: planRow!.days.length,
      }),
    )
  })

  it('renewAgentRun 不改 planRevision；标题变化才改', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    if (begin.status !== 'ok') throw new Error('unreachable')

    const before = (await repo.getRunSnapshotMeta(plan.id))!.planRevision
    await repo.renewAgentRun(plan.id, begin.token, 60_000)
    expect((await repo.getRunSnapshotMeta(plan.id))!.planRevision).toBe(before)

    await repo.updateMeta(plan.id, { title: '新标题' })
    const after = (await repo.getRunSnapshotMeta(plan.id))!.planRevision
    expect(typeof after).toBe('string')
    expect(after).not.toBe(before)
  })

  it('busy 且实况行 token 匹配 → live 附带；token 不匹配或非 busy → live=null', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    if (begin.status !== 'ok') throw new Error('unreachable')

    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningReplace: '思考中' })
    let snap = await repo.getRunSnapshotMeta(plan.id)
    expect(snap!.agentBusy).toBe(true)
    expect(snap!.live).not.toBeNull()
    expect(snap!.live!.runToken).toBe(begin.token)
    expect(snap!.live!.reasoning).toBe('思考中')

    // 残留的旧 token 实况行不算数
    await repo.upsertRunLive(plan.id, { runToken: 'stale-run', reasoningReplace: '旧实况' })
    snap = await repo.getRunSnapshotMeta(plan.id)
    expect(snap!.live).toBeNull()
  })
})

describe('PrismaTripPlanRepo.getRunSnapshotMeta', () => {
  beforeEach(() => {
    mockedFindUnique.mockReset()
  })

  it('单次 findUnique 携带约定的 select；空库返回 null', async () => {
    mockedFindUnique.mockResolvedValue(null)
    const repo = new PrismaTripPlanRepo()
    expect(await repo.getRunSnapshotMeta('plan-1')).toBeNull()
    expect(mockedFindUnique).toHaveBeenCalledTimes(1)
    const args = mockedFindUnique.mock.calls[0][0] as { where: unknown; select: Record<string, unknown> }
    expect(args.where).toEqual({ id: 'plan-1' })
    expect(Object.keys(args.select).sort()).toEqual(
      [
        '_count',
        'agentBusyUntil',
        'agentRunToken',
        'bangumiIds',
        'dayCount',
        'messages',
        'runLive',
        'startDate',
        'stage',
        'status',
        'title',
      ].sort(),
    )
  })

  it('busy 未过期且 runLive.runToken 匹配 → 组装快照（planRevision 不含租约字段）', async () => {
    const lastMessageAt = new Date('2026-09-06T08:01:00Z')
    mockedFindUnique.mockResolvedValue({
      title: '东京巡礼',
      status: 'draft',
      startDate: null,
      dayCount: 2,
      bangumiIds: [12, 34],
      stage: 'deliver',
      agentBusyUntil: new Date(Date.now() + 30_000),
      agentRunToken: 'run-1',
      runLive: {
        runToken: 'run-1',
        reasoning: '思考',
        statusText: '搜索中',
        toolCalls: [{ name: 'read_plan', status: 'done' }],
        updatedAt: new Date('2026-09-06T08:01:30Z'),
      },
      _count: { messages: 4, days: 2 },
      messages: [{ createdAt: lastMessageAt }],
    })
    const repo = new PrismaTripPlanRepo()
    const snap = await repo.getRunSnapshotMeta('plan-1')
    expect(snap!.agentBusy).toBe(true)
    expect(snap!.planRevision).toBe(
      composePlanRevision({
        title: '东京巡礼',
        status: 'draft',
        startDate: null,
        dayCount: 2,
        bangumiIds: [12, 34],
        stage: 'deliver',
        dayTotal: 2,
      }),
    )
    expect(snap!.messageCount).toBe(4)
    expect(snap!.lastMessageAt).toBe(lastMessageAt)
    expect(snap!.live!.runToken).toBe('run-1')
    expect(snap!.live!.reasoning).toBe('思考')
  })

  it('busy 已过期 → agentBusy=false 且 live=null；token 不匹配同样 live=null', async () => {
    mockedFindUnique.mockResolvedValue({
      title: 't',
      status: 'draft',
      startDate: null,
      dayCount: 1,
      bangumiIds: [],
      stage: null,
      agentBusyUntil: new Date(Date.now() - 1_000),
      agentRunToken: 'run-1',
      runLive: { runToken: 'run-1', reasoning: 'x', statusText: null, toolCalls: null, updatedAt: new Date() },
      _count: { messages: 1, days: 0 },
      messages: [{ createdAt: new Date() }],
    })
    const repo = new PrismaTripPlanRepo()
    expect((await repo.getRunSnapshotMeta('plan-1'))!.agentBusy).toBe(false)
    expect((await repo.getRunSnapshotMeta('plan-1'))!.live).toBeNull()

    mockedFindUnique.mockResolvedValue({
      title: 't',
      status: 'draft',
      startDate: null,
      dayCount: 1,
      bangumiIds: [],
      stage: null,
      agentBusyUntil: new Date(Date.now() + 30_000),
      agentRunToken: 'run-new',
      runLive: { runToken: 'run-old', reasoning: 'x', statusText: null, toolCalls: null, updatedAt: new Date() },
      _count: { messages: 1, days: 0 },
      messages: [{ createdAt: new Date() }],
    })
    expect((await repo.getRunSnapshotMeta('plan-1'))!.live).toBeNull()
  })
})
