import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import { createEnrichBudget } from '@/lib/planAgent/enrich'
import type { TripPlanWithDays } from '@/lib/tripPlan/repo'
import type { PointFinder } from '@/lib/planAgent/points'

/**
 * M4 修复 #3/#4：补齐预算挂 PlanAgentToolDeps、同一 run 内多次 save 共享
 * （第二次不重烧已补齐的腿）；hard 失败仍拒绝。enrichers 在归一化时间序上
 * 运行——交通行插在时间相邻（而非原始顺序相邻）的条目之间，再次保存不重复。
 */

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return [
      { id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' },
      { id: 'p2', name: '大吉山', nameZh: '大吉山', lat: 34.8963, lng: 135.8123, ep: '8' },
    ]
  },
  async getPointsByIds(ids) {
    const all = await this.listPoints(115908, 100)
    return all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))
  },
}

async function makeDeps() {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const travel = vi.fn(async () => ({
    ok: true as const,
    mode: 'walking' as const,
    legs: [],
    durationSeconds: 480,
    distanceMeters: 600,
    transfers: 0,
    walkSeconds: 480,
    transitSeconds: 0,
    polyline: [],
  }))
  const deps: PlanAgentToolDeps = {
    planId: plan.id,
    repo,
    points: finder,
    travel: travel as unknown as PlanAgentToolDeps['travel'],
    enrichBudget: createEnrichBudget(),
  }
  return { deps, repo, planId: plan.id, travel }
}

/** 把落库后的天数回放成下一次 save_plan_days 的输入（模拟模型照抄补齐结果重存） */
function daysForResave(plan: TripPlanWithDays) {
  return plan.days.map((day) => ({
    dayIndex: day.dayIndex,
    items: day.items.map((item) => ({
      type: item.type,
      ...(item.pointId ? { pointId: item.pointId } : {}),
      title: item.title,
      ...(item.timeHint ? { timeHint: item.timeHint } : {}),
      ...(item.note ? { note: item.note } : {}),
      payload: item.payload ?? undefined,
    })),
  }))
}

describe('save_plan_days 补齐预算跨保存共享（M4 #3）', () => {
  it('同一份 enrichBudget 两次 save：第二次回放已补齐的天数，不再重复外呼交通', async () => {
    const { deps, repo, planId, travel } = await makeDeps()
    const first = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              { type: 'point', pointId: 'p2', title: '大吉山' },
            ],
          },
        ],
      }),
    )
    expect(first.ok).toBe(true)
    expect(first.enrich.applied.transport).toBe(1)
    expect(travel).toHaveBeenCalledTimes(1)
    expect(deps.enrichBudget?.directions.used).toBe(1)

    // 第二次 save 回放第一次落库的结果（含服务端插入的 transit 行）
    const saved = await repo.getPlan(planId)
    expect(saved).toBeTruthy()
    const second = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', { days: daysForResave(saved!) }),
    )
    expect(second.ok).toBe(true)
    expect(second.enrich.applied.transport).toBe(0)
    // 没有为已补齐的腿再打 Google，预算不被重烧
    expect(travel).toHaveBeenCalledTimes(1)
    expect(deps.enrichBudget?.directions.used).toBe(1)
    const resaved = await repo.getPlan(planId)
    expect(resaved?.days[0].items.filter((i) => i.type === 'transit')).toHaveLength(1)
  })

  it('hard 失败（attraction 坐标缺失）仍拒绝落库，返回整改单；meal/lodging 坐标缺口是 soft 不再拦截', async () => {
    const { deps, repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'attraction', title: '神秘景点' }] }],
      }),
    )
    expect(out.ok).toBeUndefined()
    expect(out.error).toBe('质量门控未通过，未落库')
    expect(out.gates).toContainEqual(expect.objectContaining({ gate: 'coords', itemTitle: '神秘景点', severity: 'hard' }))
    expect((await repo.getPlan(planId))?.days).toHaveLength(0)
  })
})

describe('save_plan_days 先归一化排序再补齐（M4 #4）', () => {
  it('N1：[A(无时间), transit A→B, B@09:00] 预排序成块移动（transit 钉在 A 后），不再插第二条交通行；重存不增行', async () => {
    const { deps, repo, planId, travel } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              { type: 'transit', title: '宇治桥 → 大吉山', payload: { transport: { mode: 'walk', durationMin: 8, provider: 'google' } } },
              { type: 'point', pointId: 'p2', title: '大吉山', timeHint: '09:00' },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    // 已有交通行仍钉在 A→B 之间（归一化顺延不再把它拆到 B 后面），enricher 不重复插行
    expect(out.enrich.applied.transport).toBe(0)
    expect(travel).not.toHaveBeenCalled()
    const saved = await repo.getPlan(planId)
    const transitRows = saved?.days[0].items.filter((i) => i.type === 'transit') ?? []
    expect(transitRows).toHaveLength(1)
    expect(saved?.days[0].items.map((i) => i.title)).toEqual(['宇治桥', '宇治桥 → 大吉山', '大吉山'])

    // 重存（回放落库结果）不增行
    const second = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', { days: daysForResave(saved!) }),
    )
    expect(second.ok).toBe(true)
    expect(second.enrich.applied.transport).toBe(0)
    expect(travel).not.toHaveBeenCalled()
    const resaved = await repo.getPlan(planId)
    expect(resaved?.days[0].items.filter((i) => i.type === 'transit')).toHaveLength(1)
    expect(planId).toBeTruthy()
  })

  it('[A@14:00, B@09:00] → 交通行插在时间序相邻的 B→A 之间，而不是原始顺序的 A→B', async () => {
    const { deps, repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥', timeHint: '14:00' },
              { type: 'point', pointId: 'p2', title: '大吉山', timeHint: '09:00' },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    const saved = await repo.getPlan(planId)
    const items = saved?.days[0].items ?? []
    // 时间序：大吉山(09:00) → 交通 → 宇治桥(14:00)
    expect(items.map((i) => i.title)).toEqual(['大吉山', '大吉山 → 宇治桥', '宇治桥'])
    expect(out.quality.stats.missingTransit).toBe(0)

    // 再次保存（回放落库结果）不产生重复交通行
    const second = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', { days: daysForResave(saved!) }),
    )
    expect(second.ok).toBe(true)
    expect(second.enrich.applied.transport).toBe(0)
    const resaved = await repo.getPlan(planId)
    expect(resaved?.days[0].items.filter((i) => i.type === 'transit')).toHaveLength(1)
  })
})
