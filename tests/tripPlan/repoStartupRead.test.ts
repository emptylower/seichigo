import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'

vi.mock('@/lib/db/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { prisma } from '@/lib/db/prisma'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'

const mockedQueryRaw = prisma.$queryRaw as unknown as Mock

/**
 * P2-B（2026-09-11）：getStartupRead——loop 启动前奏的一次性读取（1 条 SQL）
 * 的 Memory 实现。字段语义与三段旧读（isAgentRunStopped / listMessages /
 * getStageInputs）一一对应。
 */

async function heldRun(repo: MemoryTripPlanRepo) {
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const begin = await repo.beginAgentRun({
    planId: plan.id,
    userId: 'u1',
    content: { role: 'user', content: 'hi' },
    since: new Date(0),
    limit: 10,
    busyTtlMs: 60_000,
  })
  if (begin.status !== 'ok') throw new Error('unreachable')
  return { plan, token: begin.token }
}

describe('MemoryTripPlanRepo.getStartupRead', () => {
  it('计划不存在 → null', async () => {
    const repo = new MemoryTripPlanRepo()
    expect(await repo.getStartupRead('nope')).toBeNull()
  })

  it('agentRunToken 派生自 busy 表：run 持有中返回当前 token，结束后回到 null', async () => {
    const repo = new MemoryTripPlanRepo()
    const { plan, token } = await heldRun(repo)
    expect((await repo.getStartupRead(plan.id))!.agentRunToken).toBe(token)
    await repo.endAgentRun(plan.id, token)
    expect((await repo.getStartupRead(plan.id))!.agentRunToken).toBeNull()
  })

  it('messages 与 listMessages 同序同值（createdAt 升序、类型一致）；stageInputs 与 getStageInputs 逐字段一致', async () => {
    const repo = new MemoryTripPlanRepo()
    const { plan } = await heldRun(repo)
    await repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: '一' })
    await repo.appendMessage(plan.id, 'tool', { role: 'tool', tool_call_id: 'c1', content: '{}' })
    await repo.appendMessage(plan.id, 'daymap', { days: [] })
    await repo.updateMeta(plan.id, { bangumiIds: [7], dayCount: 3, startDate: new Date('2026-10-01T00:00:00Z') })

    const read = await repo.getStartupRead(plan.id)
    const listed = await repo.listMessages(plan.id)
    expect(read!.messages).toEqual(listed)

    const stageInputs = await repo.getStageInputs(plan.id)
    expect(read!.stageInputs).toEqual(stageInputs)
    expect(read!.stageInputs).toMatchObject({ bangumiIds: [7], dayCount: 3 })
  })

  it('hasPointItem 三种情形：无 day / 有 item 但 pointId 为空串或 null / 有真 pointId', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    await repo.replaceDays(plan.id, [])
    expect((await repo.getStartupRead(plan.id))!.stageInputs.hasPointItem).toBe(false)

    await repo.replaceDays(plan.id, [
      {
        dayIndex: 0,
        items: [
          { type: 'free', title: '外部', pointId: '' },
          { type: 'meal', title: '无点', pointId: null },
        ],
      },
    ])
    expect((await repo.getStartupRead(plan.id))!.stageInputs.hasPointItem).toBe(false)

    await repo.replaceDays(plan.id, [
      {
        dayIndex: 0,
        items: [
          { type: 'free', title: '外部', pointId: '' },
          { type: 'point', title: '圣地', pointId: 'pt-1' },
        ],
      },
    ])
    expect((await repo.getStartupRead(plan.id))!.stageInputs.hasPointItem).toBe(true)
  })
})

/**
 * 评审修正 2（2026-09-11）：Prisma 路径此前完全没测——修正 1 的 createdAt
 * 时区 bug（timestamp(3) 无偏移串被本地时区解析）正是死在这个缺口上。
 * mock $queryRaw（同 runSnapshotMeta.test.ts 的 vi.mock('@/lib/db/prisma')
 * 模式）返回一条真实形状的行，锁住行映射与 SQL 里的 Z 后缀。
 */
describe('PrismaTripPlanRepo.getStartupRead（mock $queryRaw）', () => {
  beforeEach(() => {
    mockedQueryRaw.mockReset()
  })

  const row = {
    agentRunToken: 'tok-1',
    bangumiIds: [160209, 7],
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    dayCount: 2,
    hasPointItem: true,
    messages: [
      {
        id: 'm1',
        planId: 'p1',
        kind: 'human',
        content: { role: 'user', content: '帮我排一天' },
        // to_char 输出：带 Z 的 UTC 串（dev 机器 UTC+8 下少了 Z 就会差 8 小时）
        createdAt: '2026-09-10T06:45:40.014Z',
      },
      {
        id: 'm2',
        planId: 'p1',
        kind: 'daymap',
        content: { days: [], quality: 'ok' },
        createdAt: '2026-09-10T06:45:41.500Z',
      },
    ],
  }

  it('行映射：createdAt 为带 Z 串解析出的同一瞬时（不随本地时区漂移），类型逐字正确', async () => {
    mockedQueryRaw.mockResolvedValue([row])
    const repo = new PrismaTripPlanRepo()

    const read = await repo.getStartupRead('p1')
    expect(read).not.toBeNull()
    // 1 条 SQL / 1 次往返
    expect(mockedQueryRaw).toHaveBeenCalledTimes(1)

    expect(read!.agentRunToken).toBe('tok-1')
    expect(read!.stageInputs).toEqual({
      bangumiIds: [160209, 7],
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      dayCount: 2,
      hasPointItem: true,
    })
    expect(read!.stageInputs.bangumiIds.every((n) => typeof n === 'number')).toBe(true)
    expect(typeof read!.stageInputs.hasPointItem).toBe('boolean')

    const [first, second] = read!.messages
    expect(read!.messages).toHaveLength(2)
    expect(first!.createdAt).toBeInstanceOf(Date)
    // 瞬时锁死：Date.UTC 算出来的毫秒，与运行机器的 TZ 无关
    expect(first!.createdAt.getTime()).toBe(Date.UTC(2026, 8, 10, 6, 45, 40, 14))
    expect(second!.createdAt.getTime()).toBe(Date.UTC(2026, 8, 10, 6, 45, 41, 500))
    expect(second!.createdAt.getTime() - first!.createdAt.getTime()).toBe(1_486)
    expect(first!.id).toBe('m1')
    expect(first!.planId).toBe('p1')
    expect(first!.kind).toBe('human')
    expect(first!.content).toEqual({ role: 'user', content: '帮我排一天' })
    expect(second!.kind).toBe('daymap')
  })

  it('SQL 把 createdAt to_char 成带 Z 的串（时区回归闸门）', async () => {
    mockedQueryRaw.mockResolvedValue([row])
    await new PrismaTripPlanRepo().getStartupRead('p1')

    // $queryRaw 是标签模板：第一个参数是字符串片段数组
    const sql = (mockedQueryRaw.mock.calls[0]![0] as unknown as string[]).join('?')
    expect(sql).toContain(`to_char(m."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
    // 裸列值会输出不带偏移的串 → new Date 按本地时区解析
    expect(sql).not.toContain(`'createdAt', m."createdAt"`)
  })

  it('计划不存在（rows=0）→ null', async () => {
    mockedQueryRaw.mockResolvedValue([])
    expect(await new PrismaTripPlanRepo().getStartupRead('nope')).toBeNull()
  })

  it('无消息的计划：json_agg 的 COALESCE 兜底空数组 → messages=[]', async () => {
    mockedQueryRaw.mockResolvedValue([{ ...row, agentRunToken: null, messages: [] }])
    const read = await new PrismaTripPlanRepo().getStartupRead('p1')
    expect(read!.agentRunToken).toBeNull()
    expect(read!.messages).toEqual([])
  })
})
