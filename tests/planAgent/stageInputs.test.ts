import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { derivePlanStage, stageInputsOfPlan } from '@/lib/planAgent/stage'
import type { PlanQualityReport } from '@/lib/planAgent/gates'
import type { TripPlanMessage } from '@/lib/tripPlan/repo'

/**
 * CUT-3 等价性（2026-09-10）：getStageInputs 轻量投影（单条 SQL）必须与
 * 「拉整棵 getPlan 再 stageInputsOfPlan」产出完全相同的阶段判定。表驱动
 * 覆盖六格阶段 × pointId（null/''/正常值）× days（空/全外部地点）。
 */

const msg = (kind: TripPlanMessage['kind'], id: string): TripPlanMessage => ({
  id,
  planId: 'p',
  kind,
  content: { role: kind === 'human' ? 'user' : 'assistant', content: id },
  createdAt: new Date(),
})

const daymapMsg = (id: string, quality: PlanQualityReport | null): TripPlanMessage => ({
  id,
  planId: 'p',
  kind: 'daymap',
  content: { type: 'daymap', revisionId: `rev-${id}`, savedAt: '2026-09-02T00:00:00Z', days: [], ...(quality ? { quality } : {}) },
  createdAt: new Date(),
})

const passedQuality: PlanQualityReport = {
  passed: true,
  hard: [],
  soft: [],
  stats: { visitItems: 1, withCoords: 1, withMedia: 1, transitLegs: 0, transitReal: 0, transitEstimated: 0, missingTransit: 0, daySpanMaxMin: 120 },
  evaluatedAt: '2026-09-02T00:00:00Z',
}

const failedQuality: PlanQualityReport = {
  passed: false,
  hard: [{ gate: 'coords', severity: 'hard', dayIndex: 1, itemTitle: 'x', fix: '缺坐标' }],
  soft: [],
  stats: { visitItems: 1, withCoords: 0, withMedia: 0, transitLegs: 0, transitReal: 0, transitEstimated: 0, missingTransit: 0, daySpanMaxMin: 120 },
  evaluatedAt: '2026-09-02T00:00:00Z',
}

type Case = {
  name: string
  expected: string
  plan: {
    bangumiIds?: number[]
    startDate?: Date | null
    dayCount?: number
    /** 每天的条目 pointId 列表；省略 days = 空数组 */
    dayPointIds?: Array<Array<string | null>>
  }
  messages: TripPlanMessage[]
  quality: PlanQualityReport | null
}

const cases: Case[] = [
  {
    name: 'works：bangumiIds 为空',
    expected: 'works',
    plan: { bangumiIds: [], dayPointIds: [['p1']] },
    messages: [msg('human', 'm1')],
    quality: null,
  },
  {
    name: 'dates：startDate 缺失（dayCount 正常）',
    expected: 'dates',
    plan: { startDate: null, dayCount: 2, dayPointIds: [['p1']] },
    messages: [msg('human', 'm1')],
    quality: null,
  },
  {
    name: 'dates：dayCount=1（startDate 正常）',
    expected: 'dates',
    plan: { dayCount: 1, dayPointIds: [['p1']] },
    messages: [msg('human', 'm1')],
    quality: null,
  },
  {
    name: 'points：days.length === 0',
    expected: 'points',
    plan: {},
    messages: [msg('human', 'm1')],
    quality: null,
  },
  {
    name: 'points：days > 0 但条目全 pointId=null（外部地点）——裸计数会把这格调错',
    expected: 'points',
    plan: { dayPointIds: [[null, null]] },
    messages: [msg('human', 'm1')],
    quality: null,
  },
  {
    name: "points：pointId=''（空串非真值）——缺 notIn 会把这格调错",
    expected: 'points',
    plan: { dayPointIds: [['', null]] },
    messages: [msg('human', 'm1')],
    quality: null,
  },
  {
    name: 'enrich：有点位条目但最近 daymap 门控未过',
    expected: 'enrich',
    plan: { dayPointIds: [['p1', null]] },
    messages: [msg('human', 'm1'), daymapMsg('d1', failedQuality), msg('human', 'm2')],
    quality: failedQuality,
  },
  {
    name: 'enrich：有 days 却从未交付过 daymap（历史遗留）',
    expected: 'enrich',
    plan: { dayPointIds: [['p1']] },
    messages: [msg('human', 'm1')],
    quality: null,
  },
  {
    name: 'deliver：门控通过且最近 daymap 后无 human',
    expected: 'deliver',
    plan: { dayPointIds: [['p1']] },
    messages: [msg('human', 'm1'), daymapMsg('d1', passedQuality)],
    quality: passedQuality,
  },
  {
    name: 'revise：最近 daymap 后有 human',
    expected: 'revise',
    plan: { dayPointIds: [['p1', 'p2']] },
    messages: [msg('human', 'm1'), daymapMsg('d1', passedQuality), msg('human', 'm2')],
    quality: passedQuality,
  },
  {
    name: '混合边界：多天里仅第二天有一个真值 pointId',
    expected: 'revise',
    plan: { dayPointIds: [[null, ''], ['p9']] },
    messages: [msg('human', 'm1'), daymapMsg('d1', passedQuality), msg('human', 'm2')],
    quality: passedQuality,
  },
]

async function seedPlan(repo: MemoryTripPlanRepo, c: Case): Promise<string> {
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  await repo.updateMeta(plan.id, {
    bangumiIds: c.plan.bangumiIds ?? [115908],
    startDate: c.plan.startDate === undefined ? new Date('2026-09-15T00:00:00Z') : c.plan.startDate,
    dayCount: c.plan.dayCount ?? 2,
  })
  if (c.plan.dayPointIds) {
    await repo.replaceDays(
      plan.id,
      c.plan.dayPointIds.map((pointIds, i) => ({
        dayIndex: i + 1,
        items: pointIds.map((pointId) => ({ type: 'point' as const, pointId, title: `条目${pointId ?? 'ext'}` })),
      })),
    )
  }
  return plan.id
}

describe('CUT-3：getStageInputs 轻量投影与整棵 plan 的阶段判定逐格等价', () => {
  for (const c of cases) {
    it(`${c.name} → ${c.expected}`, async () => {
      const repo = new MemoryTripPlanRepo()
      const planId = await seedPlan(repo, c)
      const direct = await repo.getStageInputs(planId)
      const viaFull = stageInputsOfPlan((await repo.getPlan(planId))!)
      // 逐字段等价（投影本身没算错）
      expect(direct).toEqual(viaFull)
      // 阶段判定等价（两种取数路径给出同一个格子）
      expect(direct).not.toBeNull()
      expect(
        derivePlanStage({ plan: direct!, messages: c.messages, quality: c.quality }),
      ).toBe(derivePlanStage({ plan: viaFull, messages: c.messages, quality: c.quality }))
      expect(derivePlanStage({ plan: direct!, messages: c.messages, quality: c.quality })).toBe(c.expected)
    })
  }

  it('计划不存在 → getStageInputs 返回 null（与 getPlan 同语义）', async () => {
    const repo = new MemoryTripPlanRepo()
    expect(await repo.getStageInputs('plan-404')).toBeNull()
  })
})
