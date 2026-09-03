import { describe, it, expect } from 'vitest'
import { runMealEnricher } from '@/lib/planAgent/enrich/mealEnricher'
import { emptyEnrichReport, type EnrichContext, type EnrichBudget, type EnrichDay } from '@/lib/planAgent/enrich/types'

/**
 * 回归第四轮 A6：用餐归一。free +「自理」→ meal + slot + 标题清洗；
 * 按时间推断 slot；已有合法 slot 不动；places 预算预留 = 无餐厅的午餐/晚餐数。
 */

function ctxWithBudget(budget?: EnrichBudget): EnrichContext {
  return { deps: {}, coordsByPointId: new Map(), ...(budget ? { budget } : {}) }
}

function day(items: EnrichDay['items']): EnrichDay[] {
  return [{ dayIndex: 1, citySlug: null, summary: null, items }]
}

describe('runMealEnricher（用餐归一 + 餐厅必达预留）', () => {
  it('free「晚餐自理」→ meal/dinner/标题「晚餐」', () => {
    const days = day([{ type: 'free', title: '晚餐自理' }])
    const report = emptyEnrichReport()
    runMealEnricher(days, ctxWithBudget(), report)
    const item = days[0].items[0]
    expect(item.type).toBe('meal')
    expect(item.payload?.mealSlot).toBe('dinner')
    expect(item.title).toBe('晚餐')
    expect(report.applied.meal).toBe(1)
  })

  it('「12:00 用餐」→ lunch（时刻推断）；「夜宵」→ dinner', () => {
    const days = day([
      { type: 'free', title: '12:00 用餐', timeHint: '12:00' },
      { type: 'free', title: '吃点夜宵', timeHint: '21:30' },
    ])
    runMealEnricher(days, ctxWithBudget(), emptyEnrichReport())
    expect(days[0].items[0].payload?.mealSlot).toBe('lunch')
    expect(days[0].items[1].payload?.mealSlot).toBe('dinner')
  })

  it('按小时分档：< 10:30 breakfast、< 16:00 lunch、其余 dinner；完全无法判断 → lunch', () => {
    const days = day([
      { type: 'meal', title: '吃饭', timeHint: '08:00' },
      { type: 'meal', title: '吃饭', timeHint: '15:59' },
      { type: 'meal', title: '吃饭', timeHint: '18:00' },
      { type: 'meal', title: '吃饭' },
    ])
    runMealEnricher(days, ctxWithBudget(), emptyEnrichReport())
    expect(days[0].items.map((i) => i.payload?.mealSlot)).toEqual(['breakfast', 'lunch', 'dinner', 'lunch'])
  })

  it('已是 meal 且 slot 合法不动（幂等：第二次 applied.meal === 0）', () => {
    const days = day([{ type: 'meal', title: '拉面一乐', payload: { mealSlot: 'lunch' } }])
    const first = emptyEnrichReport()
    runMealEnricher(days, ctxWithBudget(), first)
    expect(first.applied.meal).toBe(0)
    expect(days[0].items[0].payload?.mealSlot).toBe('lunch')
    expect(days[0].items[0].title).toBe('拉面一乐')
    const second = emptyEnrichReport()
    runMealEnricher(days, ctxWithBudget(), second)
    expect(second.applied.meal).toBe(0)
  })

  it('标题清洗：去掉「自行安排/自由用餐」与首尾标点；清洗后为空按 slot 写回', () => {
    const days = day([
      { type: 'meal', title: '午餐，自行安排。' },
      { type: 'free', title: '自理' },
    ])
    runMealEnricher(days, ctxWithBudget(), emptyEnrichReport())
    expect(days[0].items[0].title).toBe('午餐')
    expect(days[0].items[0].payload?.mealSlot).toBe('lunch')
    // 「自理」清空后按默认 slot（lunch）写「午餐」
    expect(days[0].items[1].type).toBe('meal')
    expect(days[0].items[1].title).toBe('午餐')
    expect(days[0].items[1].payload?.mealSlot).toBe('lunch')
  })

  it('R1：note 命中用餐关键词不再归一（只看标题），条目保持原类型', () => {
    const days = day([{ type: 'free', title: '商场逛街', note: '中午在这里吃饭' }])
    const report = emptyEnrichReport()
    runMealEnricher(days, ctxWithBudget(), report)
    expect(days[0].items[0].type).toBe('free')
    expect(days[0].items[0].payload ?? null).toBeNull()
    expect(report.applied.meal).toBe(0)
  })

  it('R1：带 pointId 的 point 条目即使标题/note 命中用餐关键词也不改类型（作品点位不被吞）', () => {
    const days = day([
      { type: 'point', pointId: 'p1', title: '某踏切', note: '参观后午餐' },
      { type: 'point', pointId: 'p2', title: '午餐场景的拉面店' },
    ])
    runMealEnricher(days, ctxWithBudget(), emptyEnrichReport())
    expect(days[0].items[0].type).toBe('point')
    expect(days[0].items[0].payload ?? null).toBeNull()
    expect(days[0].items[1].type).toBe('point')
  })

  it('R1：已带合法 place 的非 meal 条目即使标题命中也不改类型', () => {
    const days = day([
      { type: 'free', title: '午餐后闲逛', payload: { place: { provider: 'google', placeId: 'ChIJ_p', name: '公园', lat: 1, lng: 2 } } },
    ])
    runMealEnricher(days, ctxWithBudget(), emptyEnrichReport())
    expect(days[0].items[0].type).toBe('free')
    expect((days[0].items[0].payload as Record<string, unknown>).mealSlot).toBeUndefined()
  })

  it('reserved 计算：无合法 place 的 lunch/dinner meal 条目数（breakfast 不计），上限 places.max', () => {
    const budget: EnrichBudget = { directions: { used: 0, max: 12 }, places: { used: 0, max: 2 }, windowStartedAt: Date.now() }
    const days = day([
      { type: 'meal', title: '早餐', payload: { mealSlot: 'breakfast' } },
      { type: 'meal', title: '午餐', payload: { mealSlot: 'lunch' } },
      { type: 'meal', title: '晚餐', payload: { mealSlot: 'dinner' } },
      { type: 'meal', title: '已有餐厅的午餐', payload: { mealSlot: 'lunch', place: { provider: 'google', placeId: 'ChIJ_r', name: '餐厅', lat: 1, lng: 2 } } },
    ])
    runMealEnricher(days, ctxWithBudget(budget), emptyEnrichReport())
    expect(budget.places.reserved).toBe(2) // 午餐 + 晚餐（breakfast 与已有 place 的不计）

    const capped: EnrichBudget = { directions: { used: 0, max: 12 }, places: { used: 0, max: 1 }, windowStartedAt: Date.now() }
    const many = day([
      { type: 'meal', title: '午餐一', payload: { mealSlot: 'lunch' } },
      { type: 'meal', title: '晚餐一', payload: { mealSlot: 'dinner' } },
    ])
    runMealEnricher(many, ctxWithBudget(capped), emptyEnrichReport())
    expect(capped.places.reserved).toBe(1) // 上限 places.max
  })
})
