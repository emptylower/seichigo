import { describe, it, expect } from 'vitest'
import { buildStageContext, derivePlanStage, type PlanStage } from '@/lib/planAgent/stage'
import type { PlanQualityReport } from '@/lib/planAgent/gates'
import type { EnrichReport } from '@/lib/planAgent/enrich/types'
import type { TripPlanMessage, TripPlanWithDays } from '@/lib/tripPlan/repo'

/**
 * 阶段判定表（设计 §3）：六种阶段各一例 + 中途换作品回退 works。
 * 阶段只由持久化证据（bangumiIds/日期/days/daymap/quality/人类消息）推断。
 */

function makePlan(over: Partial<TripPlanWithDays> = {}): TripPlanWithDays {
  return {
    id: 'plan-1',
    userId: 'u1',
    title: 't',
    status: 'draft',
    stage: null,
    agentRunToken: null,
    agentBusyUntil: null,
    startDate: new Date('2026-09-15T00:00:00Z'),
    dayCount: 2,
    bangumiIds: [115908],
    preferences: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    days: [
      {
        id: 'day-1',
        planId: 'plan-1',
        dayIndex: 1,
        date: null,
        citySlug: null,
        summary: null,
        items: [{ id: 'item-1', dayId: 'day-1', sortOrder: 0, type: 'point', pointId: '115908:uji', timeHint: null, title: '宇治桥', note: null, reason: null, payload: null, point: null }],
      },
    ],
    ...over,
  }
}

const msg = (kind: TripPlanMessage['kind'], id: string): TripPlanMessage => ({
  id,
  planId: 'plan-1',
  kind,
  content: { role: kind === 'human' ? 'user' : 'assistant', content: id },
  createdAt: new Date(),
})

const daymapMsg = (id: string, quality: PlanQualityReport | null): TripPlanMessage => ({
  id,
  planId: 'plan-1',
  kind: 'daymap',
  content: { type: 'daymap', revisionId: `rev-${id}`, savedAt: '2026-09-02T00:00:00Z', days: [], ...(quality ? { quality } : {}) },
  createdAt: new Date(),
})

const passedQuality: PlanQualityReport = {
  passed: true,
  hard: [],
  soft: [],
  stats: { visitItems: 2, withCoords: 2, withMedia: 2, transitLegs: 1, transitReal: 1, transitEstimated: 0, missingTransit: 0, daySpanMaxMin: 180 },
  evaluatedAt: '2026-09-02T00:00:00Z',
}

const failedQuality: PlanQualityReport = {
  passed: false,
  hard: [
    { gate: 'transport', severity: 'hard', dayIndex: 2, itemTitle: 'A → B', fix: '用 estimate_travel 补「A」→「B」的交通' },
    { gate: 'coords', severity: 'hard', dayIndex: 2, itemTitle: '神秘酒店', fix: '条目「神秘酒店」缺少坐标' },
  ],
  soft: [{ gate: 'media', severity: 'soft', dayIndex: 0, fix: '有图条目 2/5（低于 80%）' }],
  stats: { visitItems: 5, withCoords: 4, withMedia: 2, transitLegs: 1, transitReal: 1, transitEstimated: 0, missingTransit: 1, daySpanMaxMin: 300 },
  evaluatedAt: '2026-09-02T00:00:00Z',
}

function stageOf(input: { plan?: TripPlanWithDays; messages?: TripPlanMessage[]; quality?: PlanQualityReport | null }): PlanStage {
  return derivePlanStage({
    plan: input.plan ?? makePlan(),
    messages: input.messages ?? [msg('human', 'm1'), daymapMsg('d1', passedQuality)],
    quality: input.quality ?? null,
  })
}

describe('derivePlanStage 判定表', () => {
  it('works：bangumiIds 为空（即使已有 days/消息，中途换作品清空作品后回退）', () => {
    const plan = makePlan({ bangumiIds: [] })
    expect(stageOf({ plan, messages: [msg('human', 'm1'), daymapMsg('d1', passedQuality)], quality: passedQuality })).toBe('works')
  })

  it('dates：bangumiIds 非空但 startDate 缺失（dayCount 默认 1 也视为缺失）', () => {
    expect(stageOf({ plan: makePlan({ startDate: null }) })).toBe('dates')
    expect(stageOf({ plan: makePlan({ dayCount: 1 }) })).toBe('dates')
  })

  it('points：日期齐但 days 为空，或没有任何带 pointId 的条目', () => {
    expect(stageOf({ plan: makePlan({ days: [] }) })).toBe('points')
    const onlyExternal = makePlan()
    onlyExternal.days[0].items[0].pointId = null
    expect(stageOf({ plan: onlyExternal })).toBe('points')
  })

  it('enrich：有 days 但门控未过（quality.passed=false）', () => {
    expect(stageOf({ quality: failedQuality, messages: [msg('human', 'm1'), daymapMsg('d1', failedQuality)] })).toBe('enrich')
  })

  it('enrich：有 days 却从未有过 daymap（历史遗留）→ 重走补齐', () => {
    expect(stageOf({ messages: [msg('human', 'm1')] })).toBe('enrich')
  })

  it('deliver：门控通过且最近 daymap 之后没有新的 human 消息', () => {
    expect(stageOf({ quality: passedQuality, messages: [msg('human', 'm1'), daymapMsg('d1', passedQuality)] })).toBe('deliver')
  })

  it('revise：最近一条 daymap 之后存在 human 消息（即使此前门控通过）', () => {
    expect(
      stageOf({
        quality: passedQuality,
        messages: [msg('human', 'm1'), daymapMsg('d1', passedQuality), msg('human', 'm2')],
      }),
    ).toBe('revise')
  })

  it('门控未过优先于 revise：保存被拒（无新 daymap）后用户催促 → 仍是 enrich', () => {
    expect(
      stageOf({
        quality: failedQuality,
        messages: [msg('human', 'm1'), daymapMsg('d1', failedQuality), msg('human', 'm2')],
      }),
    ).toBe('enrich')
  })
})

describe('buildStageContext', () => {
  it('enrich 阶段：包含阶段标签、门控失败明细与建议，≤600 字', () => {
    const text = buildStageContext('enrich', failedQuality)
    expect(text).toContain('## 当前状态')
    expect(text).toContain('阶段：补齐中')
    expect(text).toContain('交通门 1 处')
    expect(text).toContain('estimate_travel')
    expect(text).toContain('提示（不影响保存）')
    expect(text).toContain('建议下一步')
    expect(text.length).toBeLessThanOrEqual(600)
  })

  it('带 EnrichReport：写明服务端自动补齐与跳过项', () => {
    const enrich: EnrichReport = {
      applied: { meal: 0, place: 2, restaurant: 1, transport: 3, schedule: 0, media: 4, dedupe: 0, neighbor: 0 },
      skipped: [{ enricher: 'place', itemTitle: '某酒店', reason: '预算用完' }],
      googleCallsUsed: { directions: 3, places: 3 },
    }
    const text = buildStageContext('deliver', passedQuality, enrich)
    expect(text).toContain('地点 2、餐厅 1、交通 3、图片 4')
    expect(text).toContain('跳过 1 项')
    expect(text).toContain('已交付')
  })

  it('deliver 阶段无 soft 时不含"提示"行', () => {
    const text = buildStageContext('deliver', passedQuality)
    expect(text).not.toContain('提示')
    expect(text).toContain('等待用户的下一步指令')
  })
})
