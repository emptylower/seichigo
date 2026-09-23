import { describe, expect, it } from 'vitest'
import {
  applyReorderLocal,
  dayDropId,
  dayLabel,
  groupItemsByDay,
  itemDisplayTitle,
  itemDragId,
  parseDayDropId,
  parseDragRecordId,
  pickTodayDayId,
  sequenceForImmersive,
} from '@/app/(authed)/me/routebooks/[id]/utils'
import { UNASSIGNED_DROP_ID } from '@/app/(authed)/me/routebooks/[id]/types'
import type { DayRecord, ItemRecord } from '@/app/(authed)/me/routebooks/[id]/types'

function item(overrides: Partial<ItemRecord> & { id: string }): ItemRecord {
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
    createdAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  }
}

function day(overrides: Partial<DayRecord> & { id: string; dayIndex: number }): DayRecord {
  return {
    routeBookId: 'rb-1',
    date: null,
    title: null,
    defaultTravelMode: 'transit',
    ...overrides,
  }
}

describe('groupItemsByDay', () => {
  it('按天分桶并各自按 sortOrder 排序；未知 dayId 归入未安排', () => {
    const days = [day({ id: 'd1', dayIndex: 1 }), day({ id: 'd2', dayIndex: 2 })]
    const items = [
      item({ id: 'a', dayId: 'd2', sortOrder: 1 }),
      item({ id: 'b', dayId: 'd1', sortOrder: 5 }),
      item({ id: 'c', dayId: null, sortOrder: 2 }),
      item({ id: 'd', dayId: 'd1', sortOrder: 1 }),
      item({ id: 'e', dayId: 'ghost', sortOrder: 0 }),
    ]
    const { byDay, unassigned } = groupItemsByDay(items, days)
    expect(byDay.get('d1')!.map((row) => row.id)).toEqual(['d', 'b'])
    expect(byDay.get('d2')!.map((row) => row.id)).toEqual(['a'])
    expect(unassigned.map((row) => row.id)).toEqual(['e', 'c'])
  })
})

describe('applyReorderLocal', () => {
  const base = [
    item({ id: 'a', dayId: 'd1', sortOrder: 0 }),
    item({ id: 'b', dayId: 'd1', sortOrder: 1 }),
    item({ id: 'c', dayId: 'd1', sortOrder: 2 }),
    item({ id: 'x', dayId: 'd2', sortOrder: 0 }),
    item({ id: 'u', dayId: null, sortOrder: 0 }),
  ]

  it('天内重排：目标天从 0 重编', () => {
    const next = applyReorderLocal(base, 'd1', ['c', 'a', 'b'])
    const d1 = next.filter((row) => row.dayId === 'd1').sort((p, q) => p.sortOrder - q.sortOrder)
    expect(d1.map((row) => row.id)).toEqual(['c', 'a', 'b'])
    expect(d1.map((row) => row.sortOrder)).toEqual([0, 1, 2])
  })

  it('跨天移动：移入目标天，源天保持相对顺序重编', () => {
    const next = applyReorderLocal(base, 'd2', ['x', 'a'])
    const d2 = next.filter((row) => row.dayId === 'd2').sort((p, q) => p.sortOrder - q.sortOrder)
    const d1 = next.filter((row) => row.dayId === 'd1').sort((p, q) => p.sortOrder - q.sortOrder)
    expect(d2.map((row) => row.id)).toEqual(['x', 'a'])
    expect(d2.map((row) => row.sortOrder)).toEqual([0, 1])
    expect(d1.map((row) => row.id)).toEqual(['b', 'c'])
    expect(d1.map((row) => row.sortOrder)).toEqual([0, 1])
  })

  it('移到未安排（dayId=null）', () => {
    const next = applyReorderLocal(base, null, ['u', 'a'])
    const unassigned = next.filter((row) => row.dayId === null).sort((p, q) => p.sortOrder - q.sortOrder)
    expect(unassigned.map((row) => row.id)).toEqual(['u', 'a'])
    expect(next.filter((row) => row.dayId === 'd1').map((row) => row.id)).toEqual(['b', 'c'])
  })

  it('从未安排移入某天', () => {
    const next = applyReorderLocal(base, 'd1', ['a', 'u', 'b', 'c'])
    const d1 = next.filter((row) => row.dayId === 'd1').sort((p, q) => p.sortOrder - q.sortOrder)
    expect(d1.map((row) => row.id)).toEqual(['a', 'u', 'b', 'c'])
    expect(next.some((row) => row.dayId === null)).toBe(false)
  })
})

describe('dayLabel', () => {
  it('无日期只有 Day N', () => {
    expect(dayLabel(day({ id: 'd1', dayIndex: 1 }), 2)).toBe('Day 2')
  })

  it('有日期时按 UTC 追加 M/D 周X', () => {
    // 2026-09-23 是周三
    expect(dayLabel(day({ id: 'd1', dayIndex: 1, date: '2026-09-23T00:00:00.000Z' }), 1)).toBe('Day 1 · 9/23 周三')
  })

  it('非法日期回退 Day N', () => {
    expect(dayLabel(day({ id: 'd1', dayIndex: 1, date: 'not-a-date' }), 3)).toBe('Day 3')
  })
})

describe('itemDisplayTitle', () => {
  const places = [{ id: 'p1', title: '东京站酒店' }]

  it('point 优先预览标题', () => {
    expect(itemDisplayTitle(item({ id: 'a', kind: 'point' }), { title: '秋叶原站', subtitle: '', image: null, geo: null }, places)).toBe('秋叶原站')
    expect(itemDisplayTitle(item({ id: 'a', kind: 'point', title: '备用名' }), null, places)).toBe('备用名')
    expect(itemDisplayTitle(item({ id: 'a', kind: 'point' }), null, places)).toBe('点位')
  })

  it('place 取 place 标题', () => {
    expect(itemDisplayTitle(item({ id: 'a', kind: 'place', placeId: 'p1' }), null, places)).toBe('东京站酒店')
    expect(itemDisplayTitle(item({ id: 'a', kind: 'place', placeId: 'ghost', title: '自命名' }), null, places)).toBe('自命名')
  })

  it('note/transit 取标题或缺省', () => {
    expect(itemDisplayTitle(item({ id: 'a', kind: 'note', title: '记得取票' }), null, places)).toBe('记得取票')
    expect(itemDisplayTitle(item({ id: 'a', kind: 'note' }), null, places)).toBe('备注')
    expect(itemDisplayTitle(item({ id: 'a', kind: 'transit' }), null, places)).toBe('交通')
  })
})

describe('sequenceForImmersive', () => {
  it('只取当天 point/place 并按 sortOrder', () => {
    const items = [
      item({ id: 'a', dayId: 'd1', kind: 'point', sortOrder: 2 }),
      item({ id: 'b', dayId: 'd1', kind: 'note', sortOrder: 0 }),
      item({ id: 'c', dayId: 'd1', kind: 'place', sortOrder: 1 }),
      item({ id: 'd', dayId: 'd2', kind: 'point', sortOrder: 0 }),
    ]
    expect(sequenceForImmersive(items, 'd1').map((row) => row.id)).toEqual(['c', 'a'])
  })
})

describe('pickTodayDayId', () => {
  const days = [
    day({ id: 'd1', dayIndex: 1, date: '2026-09-22T00:00:00.000Z' }),
    day({ id: 'd2', dayIndex: 2, date: '2026-09-23T00:00:00.000Z' }),
  ]

  it('日期匹配今天时返回该天', () => {
    expect(pickTodayDayId(days, new Date(2026, 8, 23, 12, 0, 0))).toBe('d2')
  })

  it('无匹配回退第一天', () => {
    expect(pickTodayDayId(days, new Date(2026, 8, 25, 12, 0, 0))).toBe('d1')
  })

  it('空数组返回 null', () => {
    expect(pickTodayDayId([], new Date())).toBeNull()
  })
})

describe('dnd id 约定', () => {
  it('item/pool/marker/day 前缀互不相同且可解析', () => {
    expect(parseDragRecordId(itemDragId('it-1'), 'item:')).toBe('it-1')
    expect(parseDragRecordId(itemDragId('it-1'), 'pool:')).toBeNull()
    expect(dayDropId(null)).toBe(UNASSIGNED_DROP_ID)
    expect(dayDropId('d1')).toBe('day:d1')
    expect(parseDayDropId('day:d1')).toBe('d1')
    expect(parseDayDropId(UNASSIGNED_DROP_ID)).toBeNull()
    expect(parseDayDropId('item:it-1')).toBeUndefined()
  })
})
