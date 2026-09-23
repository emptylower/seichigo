import { describe, it, expect } from 'vitest'
import {
  dayDateLabel,
  dayLabel,
  dayNavStops,
  dayNavTargets,
  dayStats,
  movableCount,
  nextDayFirstStopTitle,
} from '@/app/(authed)/me/routebooks/[id]/utils'
import type { DayLegsResult, DayRecord, ItemRecord, PlaceRecord, RouteBookDetail } from '@/app/(authed)/me/routebooks/[id]/types'

const DAYS: DayRecord[] = [
  { id: 'day1', routeBookId: 'rb1', dayIndex: 1, date: '2026-09-12T00:00:00.000Z', title: null, defaultTravelMode: 'transit' },
  { id: 'day2', routeBookId: 'rb1', dayIndex: 2, date: null, title: null, defaultTravelMode: 'driving' },
]

const PLACE: PlaceRecord = {
  id: 'place-1',
  routeBookId: 'rb1',
  kind: 'station',
  title: 'Uji Station',
  address: null,
  lat: 34.88,
  lng: 135.8,
  note: null,
  createdAt: '2026-09-23T00:00:00.000Z',
}

function makeItem(overrides: Partial<ItemRecord>): ItemRecord {
  return {
    id: 'item',
    routeBookId: 'rb1',
    dayId: 'day2',
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

const GEO: Record<string, [number, number] | null> = {
  'p:no-geo': null,
  'p:shrine': [34.89, 135.81],
}

function getPointPreview(pointId: string) {
  return {
    title: pointId === 'p:shrine' ? 'Uji Shrine' : 'Unknown Spot',
    subtitle: '',
    image: null,
    geo: GEO[pointId] ?? null,
  }
}

function makeDetail(items: ItemRecord[], places: PlaceRecord[] = []): Pick<RouteBookDetail, 'days' | 'items' | 'places'> {
  return { days: DAYS, items, places }
}

describe('nextDayFirstStopTitle（沉浸模式「明天从 X 开始」）', () => {
  it('跳过下一天开头无坐标的点位与备注，取第一个有坐标的点位名', () => {
    const detail = makeDetail([
      makeItem({ id: 'n', kind: 'note', title: 'memo', sortOrder: 0 }),
      makeItem({ id: 'a', pointId: 'p:no-geo', sortOrder: 1 }),
      makeItem({ id: 'b', pointId: 'p:shrine', sortOrder: 2 }),
    ])
    expect(nextDayFirstStopTitle(detail, DAYS[0]!, getPointPreview)).toBe('Uji Shrine')
  })

  it('下一天首个有坐标条目是自定义点：用自定义点标题；不存在的 place 视为无坐标', () => {
    const detail = makeDetail(
      [
        makeItem({ id: 'ghost', kind: 'place', placeId: 'missing', sortOrder: 0 }),
        makeItem({ id: 'pl', kind: 'place', placeId: 'place-1', sortOrder: 1 }),
      ],
      [PLACE]
    )
    expect(nextDayFirstStopTitle(detail, DAYS[0]!, getPointPreview)).toBe('Uji Station')
  })

  it('没有下一天或下一天没有可导航条目返回 null', () => {
    const detail = makeDetail([makeItem({ id: 'a', pointId: 'p:no-geo' })])
    expect(nextDayFirstStopTitle(detail, DAYS[0]!, getPointPreview)).toBeNull()
    expect(nextDayFirstStopTitle(detail, DAYS[1]!, getPointPreview)).toBeNull()
  })
})

describe('天统计 / 导航 / 可移动点（B3 去重）', () => {
  const items = [
    makeItem({ id: 'a', pointId: 'p:shrine', sortOrder: 0 }),
    makeItem({ id: 'b', pointId: 'p:no-geo', sortOrder: 1 }),
    makeItem({ id: 'c', kind: 'place', placeId: 'place-1', sortOrder: 2, locked: true, timeStart: '10:00' }),
    makeItem({ id: 'n', kind: 'note', title: 'memo', sortOrder: 3 }),
  ]
  const legs: DayLegsResult = {
    dayId: 'day2',
    stops: [
      { id: 'a', lat: 34.89, lng: 135.81 },
      { id: 'c', lat: 34.88, lng: 135.8 },
    ],
    legs: [],
    staleTransitItemIds: [],
  } as unknown as DayLegsResult

  it('dayStats：站数只数 point/place，预计小时 = 每站 40 分钟', () => {
    const stats = dayStats(items, undefined, [PLACE], getPointPreview)
    expect(stats.stopCount).toBe(3)
    expect(stats.coordCount).toBe(2)
    expect(stats.totalHours).toBeCloseTo(2)
  })

  it('movableCount：排除无坐标与锚点（locked && timeStart）', () => {
    expect(movableCount(items, [PLACE], getPointPreview)).toBe(1)
  })

  it('dayNavTargets：两站以上才有三家目标，交通方式跟当天默认', () => {
    const driving = dayNavTargets(DAYS[1]!, legs, items, [PLACE], getPointPreview)
    expect(driving.map((target) => target.provider)).toEqual(['google', 'apple', 'amap'])
    expect(driving[0]!.url).toContain('travelmode=driving')
    expect(dayNavTargets(DAYS[0]!, legs, items, [PLACE], getPointPreview)[0]!.url).toContain('travelmode=transit')
    expect(dayNavTargets(DAYS[0]!, undefined, items, [PLACE], getPointPreview)).toEqual([])
  })

  it('dayNavStops：条目取显示名，住宿首尾按坐标匹配自定义点，匹配不到用「住宿」', () => {
    const withLodging = {
      ...legs,
      stops: [
        { id: 'lodging:start', lat: 34.88, lng: 135.8, legMode: null },
        ...legs.stops,
        { id: 'lodging:end', lat: 1, lng: 2, legMode: null },
      ],
    } as DayLegsResult
    expect(dayNavStops(withLodging, items, [PLACE], getPointPreview, 'zh').map((stop) => stop.name)).toEqual([
      'Uji Station',
      'Uji Shrine',
      'Uji Station',
      '住宿',
    ])
  })

  it('dayDateLabel 与 dayLabel 日期片段一致', () => {
    expect(dayDateLabel(DAYS[0]!, 'zh')).toMatch(/^9\/12 /)
    expect(dayLabel(DAYS[0]!, 1, 'zh')).toBe(`Day 1 · ${dayDateLabel(DAYS[0]!, 'zh')}`)
    expect(dayDateLabel(DAYS[1]!, 'zh')).toBeNull()
    expect(dayLabel(DAYS[1]!, 2, 'ja')).toBe('Day 2')
  })
})
