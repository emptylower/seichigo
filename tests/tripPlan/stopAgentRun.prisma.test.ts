import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/db/prisma', () => {
  const prisma = {
    tripPlan: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    tripPlanRunLog: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    tripPlanRunLive: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async (args: { where: { planId: string } }) => ({ planId: args.where.planId })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  }
  return { prisma }
})

import { prisma } from '@/lib/db/prisma'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'
import { RUN_STOP_MARKER as MARKER_FROM_REPO } from '@/lib/tripPlan/repo'
import { RUN_STOP_MARKER } from '@/lib/planAgent/stop'

const mocked = prisma as unknown as {
  tripPlan: { findUnique: Mock; updateMany: Mock }
  tripPlanRunLog: { findFirst: Mock; create: Mock }
  tripPlanRunLive: { findUnique: Mock; upsert: Mock }
}

/** 第十一轮修复 H2：stopAgentRun 的 Prisma 落库语义（清 token + 持久 stopped 日志 + 标记行） */

describe('L5：RUN_STOP_MARKER 常量归属仓储层', () => {
  it('lib/tripPlan/repo.ts 是唯一权威来源，planAgent/stop.ts 只是 re-export 同一引用', () => {
    expect(MARKER_FROM_REPO).toBe('__stop_requested__')
    expect(RUN_STOP_MARKER).toBe(MARKER_FROM_REPO)
  })
})

describe('PrismaTripPlanRepo.stopAgentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.tripPlan.findUnique.mockResolvedValue({ agentRunToken: 'run-1' })
    mocked.tripPlan.updateMany.mockResolvedValue({ count: 1 })
  })

  it('清 token 成功时写一条 stopped 运行日志（turnIndex 接在最后一条日志之后）并写实况停止标记', async () => {
    mocked.tripPlanRunLog.findFirst.mockResolvedValue({ turnIndex: 4 })
    const repo = new PrismaTripPlanRepo()

    expect(await repo.stopAgentRun('plan-1')).toBe(true)

    // 条件清空（仍是当前持有者才动）
    expect(mocked.tripPlan.updateMany).toHaveBeenCalledWith({
      where: { id: 'plan-1', agentRunToken: 'run-1' },
      data: { agentBusyUntil: null, agentRunToken: null },
    })
    // H2：持久 stopped 日志——inferInterrupted/canResume 真正读的东西
    expect(mocked.tripPlanRunLog.create).toHaveBeenCalledTimes(1)
    expect(mocked.tripPlanRunLog.create).toHaveBeenCalledWith({
      data: { planId: 'plan-1', runToken: 'run-1', turnIndex: 5, stage: 'stopped', durationMs: 0 },
    })
    // 实况停止标记（跨隔离体可见）
    expect(mocked.tripPlanRunLive.upsert).toHaveBeenCalledTimes(1)
    const upsertArgs = mocked.tripPlanRunLive.upsert.mock.calls[0]![0] as {
      where: { planId: string }
      create: { runToken: string; statusText: string | null }
      update: { runToken: string; statusText: string | null }
    }
    expect(upsertArgs.where).toEqual({ planId: 'plan-1' })
    expect(upsertArgs.create.runToken).toBe('run-1')
    expect(upsertArgs.create.statusText).toBe(RUN_STOP_MARKER)
    expect(upsertArgs.update.statusText).toBe(RUN_STOP_MARKER)
  })

  it('无日志时 turnIndex 从 1 起；条件清空影响 0 行（已被接管）→ 返回 false 且不写日志/标记', async () => {
    mocked.tripPlanRunLog.findFirst.mockResolvedValue(null)
    const repo = new PrismaTripPlanRepo()
    expect(await repo.stopAgentRun('plan-1')).toBe(true)
    expect(mocked.tripPlanRunLog.create).toHaveBeenCalledWith({
      data: { planId: 'plan-1', runToken: 'run-1', turnIndex: 1, stage: 'stopped', durationMs: 0 },
    })

    // token 已不匹配（并发接管窗口）
    mocked.tripPlan.updateMany.mockResolvedValue({ count: 0 })
    expect(await repo.stopAgentRun('plan-1')).toBe(false)
    expect(mocked.tripPlanRunLog.create).toHaveBeenCalledTimes(1)
    expect(mocked.tripPlanRunLive.upsert).toHaveBeenCalledTimes(1)

    // 无 token：直接 false，什么也不写
    mocked.tripPlan.findUnique.mockResolvedValue({ agentRunToken: null })
    expect(await repo.stopAgentRun('plan-1')).toBe(false)
    expect(mocked.tripPlan.updateMany).toHaveBeenCalledTimes(2)
  })
})
