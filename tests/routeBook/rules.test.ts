import { describe, expect, it } from 'vitest'
import {
  assertAnchorOrder,
  assertDayLimit,
  assertLodgingNoOverlap,
  computeDayDate,
  lodgingNights,
  normalizeTransitItems,
  shiftLodgingForDelete,
  shiftLodgingForInsert,
} from '@/lib/routeBook/rules'
import { RouteBookRuleError } from '@/lib/routeBook/repo'
import type { RouteBookItem } from '@/lib/routeBook/repo'

function item(overrides: Partial<RouteBookItem> & { id: string }): RouteBookItem {
  return {
    routeBookId: 'rb-1',
    dayId: 'd1',
    sortOrder: 0,
    kind: 'point',
    pointId: null,
    placeId: null,
    title: null,
    note: null,
    timeStart: null,
    timeEnd: null,
    locked: false,
    icon: null,
    color: null,
    legMode: null,
    payload: null,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  }
}

describe('assertAnchorOrder', () => {
  it('锁定且带时间的条目按 sortOrder 必须时间非递减', () => {
    expect(() =>
      assertAnchorOrder([
        item({ id: 'a', sortOrder: 0, locked: true, timeStart: '09:00', title: '早' }),
        item({ id: 'b', sortOrder: 1, locked: true, timeStart: '10:00', title: '晚' }),
      ])
    ).not.toThrow()

    expect(() =>
      assertAnchorOrder([
        item({ id: 'a', sortOrder: 1, locked: true, timeStart: '09:00', title: '早' }),
        item({ id: 'b', sortOrder: 0, locked: true, timeStart: '10:00', title: '晚' }),
      ])
    ).toThrowError(RouteBookRuleError)
  })

  it('未锁定或无时间的条目不参与约束；标题缺失用点位/地点回退', () => {
    expect(() =>
      assertAnchorOrder([
        item({ id: 'a', sortOrder: 0, locked: false, timeStart: '10:00' }),
        item({ id: 'b', sortOrder: 1, locked: true, timeStart: '09:00' }),
      ])
    ).not.toThrow()

    expect(() =>
      assertAnchorOrder([
        item({ id: 'a', sortOrder: 0, kind: 'place', locked: true, timeStart: '12:00' }),
        item({ id: 'b', sortOrder: 1, kind: 'point', locked: true, timeStart: '11:00' }),
      ])
    ).toThrowError('「点位」(11:00) 必须排在「地点」(12:00) 之后')
  })
})

describe('assertDayLimit', () => {
  it('25 允许、26 拒绝', () => {
    expect(() => assertDayLimit(25)).not.toThrow()
    expect(() => assertDayLimit(26)).toThrowError('这一天最多 25 条')
  })
})

describe('lodging 夜晚集合', () => {
  it('nights = [from, to-1]，from==to 无夜晚', () => {
    expect(lodgingNights({ fromDayIndex: 1, toDayIndex: 4 })).toEqual([1, 2, 3])
    expect(lodgingNights({ fromDayIndex: 2, toDayIndex: 2 })).toEqual([])
  })

  it('背靠背允许、夜晚相交拒绝', () => {
    const existing = [{ id: 'l1', fromDayIndex: 1, toDayIndex: 3 }]
    expect(() => assertLodgingNoOverlap(existing, { id: 'l2', fromDayIndex: 3, toDayIndex: 5 })).not.toThrow()
    expect(() => assertLodgingNoOverlap(existing, { id: 'l2', fromDayIndex: 2, toDayIndex: 4 })).toThrowError('住宿日期与已有住宿重叠')
    // 无夜晚的锚点区间与任何区间不相交
    expect(() => assertLodgingNoOverlap(existing, { id: 'l2', fromDayIndex: 2, toDayIndex: 2 })).not.toThrow()
    // 排除自身
    expect(() => assertLodgingNoOverlap(existing, { id: 'l1', fromDayIndex: 1, toDayIndex: 3 })).not.toThrow()
  })
})

describe('lodging 下标平移', () => {
  it('insert：严格大于 afterDayIndex 才 +1', () => {
    expect(shiftLodgingForInsert({ fromDayIndex: 1, toDayIndex: 3 }, 1)).toEqual({ fromDayIndex: 1, toDayIndex: 4 })
    expect(shiftLodgingForInsert({ fromDayIndex: 2, toDayIndex: 4 }, 2)).toEqual({ fromDayIndex: 2, toDayIndex: 5 })
    expect(shiftLodgingForInsert({ fromDayIndex: 1, toDayIndex: 2 }, 3)).toEqual({ fromDayIndex: 1, toDayIndex: 2 })
  })

  it('delete：from > del 才 -1，to >= del 就 -1，to < from 返回 null', () => {
    expect(shiftLodgingForDelete({ fromDayIndex: 1, toDayIndex: 3 }, 1)).toEqual({ fromDayIndex: 1, toDayIndex: 2 })
    expect(shiftLodgingForDelete({ fromDayIndex: 3, toDayIndex: 4 }, 2)).toEqual({ fromDayIndex: 2, toDayIndex: 3 })
    expect(shiftLodgingForDelete({ fromDayIndex: 2, toDayIndex: 2 }, 2)).toBeNull()
    expect(shiftLodgingForDelete({ fromDayIndex: 1, toDayIndex: 2 }, 3)).toEqual({ fromDayIndex: 1, toDayIndex: 2 })
  })
})

describe('computeDayDate', () => {
  it('startDate 为 null 时各天为 null；否则 + (dayIndex-1) 天', () => {
    expect(computeDayDate(null, 3)).toBeNull()
    const start = new Date('2026-10-01T00:00:00.000Z')
    expect(computeDayDate(start, 1)?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(computeDayDate(start, 3)?.toISOString()).toBe('2026-10-03T00:00:00.000Z')
  })
})

describe('normalizeTransitItems', () => {
  it('transit 移到 prevItemId 紧后面并重编 sortOrder', () => {
    const a = item({ id: 'a', sortOrder: 0, kind: 'point', title: 'A' })
    const t = item({
      id: 't',
      sortOrder: 0,
      kind: 'transit',
      title: 'A→B',
      payload: { transitBetween: { prevItemId: 'a', nextItemId: 'b' } },
    })
    const b = item({ id: 'b', sortOrder: 1, kind: 'point', title: 'B' })

    const result = normalizeTransitItems([t, b, a])
    expect(result.items.map((i) => i.id)).toEqual(['b', 'a', 't'])
    expect(result.items.map((i) => i.sortOrder)).toEqual([0, 1, 2])
    expect(result.deletedTransitItemIds).toEqual([])
  })

  it('prevItemId 不在当天 → 删除；无 transitBetween → 原地保留', () => {
    const orphan = item({
      id: 't1',
      sortOrder: 0,
      kind: 'transit',
      title: '孤儿',
      payload: { transitBetween: { prevItemId: 'missing', nextItemId: 'b' } },
    })
    const loose = item({ id: 't2', sortOrder: 1, kind: 'transit', title: '散装' })
    const b = item({ id: 'b', sortOrder: 2, kind: 'point', title: 'B' })

    const result = normalizeTransitItems([orphan, loose, b])
    expect(result.deletedTransitItemIds).toEqual(['t1'])
    expect(result.items.map((i) => i.id)).toEqual(['t2', 'b'])
    expect(result.items.map((i) => i.sortOrder)).toEqual([0, 1])
  })
})
