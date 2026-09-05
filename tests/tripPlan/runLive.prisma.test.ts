import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { Prisma as PrismaRuntime } from '@seichigo/prisma-client-runtime'

vi.mock('@/lib/db/prisma', () => {
  const prisma = {
    tripPlanRunLive: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async (args: { where: { planId: string }; data: Record<string, unknown> }) => ({
        planId: args.where.planId,
        ...args.data,
        updatedAt: new Date(),
      })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  }
  return { prisma }
})

import { prisma } from '@/lib/db/prisma'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'

const mocked = prisma as unknown as {
  tripPlanRunLive: { findUnique: Mock; upsert: Mock }
}

function existingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    planId: 'plan-1',
    runToken: 'run-1',
    reasoning: '已有思考',
    statusText: '搜索中',
    toolCalls: [{ name: 'read_plan', status: 'done' }],
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.tripPlanRunLive.findUnique.mockResolvedValue(null)
})

/** 第七轮 A1 测试补充：upsertRunLive 的 Prisma 落库语义（DbNull / upsert / 接管重置） */
describe('PrismaTripPlanRepo.upsertRunLive', () => {
  it('toolCalls 缺省写 DbNull（create/update 同值），statusText 缺省写 null', async () => {
    const repo = new PrismaTripPlanRepo()
    await repo.upsertRunLive('plan-1', { runToken: 'run-1', reasoningReplace: '思考' })

    expect(mocked.tripPlanRunLive.upsert).toHaveBeenCalledTimes(1)
    const args = mocked.tripPlanRunLive.upsert.mock.calls[0]![0] as {
      where: unknown
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(args.where).toEqual({ planId: 'plan-1' })
    expect(args.create.toolCalls).toBe(PrismaRuntime.DbNull)
    expect(args.update.toolCalls).toBe(PrismaRuntime.DbNull)
    expect(args.update.statusText).toBeNull()
    expect(args.update.reasoning).toBe('思考')
  })

  it('同 run（runToken 相同）走单次 upsert：reasoning 追加、未传字段保持原值', async () => {
    mocked.tripPlanRunLive.findUnique.mockResolvedValue(
      existingRow({ reasoning: '第一段', statusText: '搜索中' }),
    )
    const repo = new PrismaTripPlanRepo()
    await repo.upsertRunLive('plan-1', { runToken: 'run-1', reasoningAppend: '第二段' })

    expect(mocked.tripPlanRunLive.findUnique).toHaveBeenCalledWith({ where: { planId: 'plan-1' } })
    expect(mocked.tripPlanRunLive.upsert).toHaveBeenCalledTimes(1)
    const data = mocked.tripPlanRunLive.upsert.mock.calls[0]![0].update as Record<string, unknown>
    expect(data.runToken).toBe('run-1')
    expect(data.reasoning).toBe('第一段第二段')
    expect(data.statusText).toBe('搜索中')
    // 原有 toolCalls 是 JSON 值（非 null），透传而不是 DbNull
    expect(data.toolCalls).toEqual([{ name: 'read_plan', status: 'done' }])
  })

  it('不同 runToken = 新 run 接管：整行重置（reasoning 不拼接旧值，未传字段回 null/DbNull）', async () => {
    mocked.tripPlanRunLive.findUnique.mockResolvedValue(
      existingRow({ runToken: 'run-old', reasoning: '旧 run 的思考', statusText: '旧状态' }),
    )
    const repo = new PrismaTripPlanRepo()
    await repo.upsertRunLive('plan-1', { runToken: 'run-new', reasoningAppend: '新 run 起步' })

    const data = mocked.tripPlanRunLive.upsert.mock.calls[0]![0].update as Record<string, unknown>
    expect(data.runToken).toBe('run-new')
    expect(data.reasoning).toBe('新 run 起步')
    expect(data.statusText).toBeNull()
    expect(data.toolCalls).toBe(PrismaRuntime.DbNull)
  })

  it('reasoning 超上限截头保尾后落库', async () => {
    const repo = new PrismaTripPlanRepo()
    const long = 'a'.repeat(25_000)
    await repo.upsertRunLive('plan-1', { runToken: 'run-1', reasoningReplace: long })
    const data = mocked.tripPlanRunLive.upsert.mock.calls[0]![0].update as Record<string, unknown>
    expect((data.reasoning as string)).toHaveLength(20_000)
    expect((data.reasoning as string).startsWith('a')).toBe(true)
  })
})
