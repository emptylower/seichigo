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
import type {
  DayLegsResult,
  DayRecord,
  ItemRecord,
  LodgingRecord,
  PlaceRecord,
  RouteBookDetail,
} from '@/app/(authed)/me/routebooks/[id]/types'

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

  it('之后各天都没有可导航条目或没有下一天返回 null', () => {
    const detail = makeDetail([makeItem({ id: 'a', pointId: 'p:no-geo' })])
    expect(nextDayFirstStopTitle(detail, DAYS[0]!, getPointPreview)).toBeNull()
    expect(nextDayFirstStopTitle(detail, DAYS[1]!, getPointPreview)).toBeNull()
  })

  it('下一天是空天时向后找第一个有站的天（G13）', () => {
    const day3: DayRecord = { id: 'day3', routeBookId: 'rb1', dayIndex: 3, date: null, title: null, defaultTravelMode: 'transit' }
    const detail = {
      days: [...DAYS, day3],
      items: [
        makeItem({ id: 'n', dayId: 'day2', kind: 'note', title: 'memo' }),
        makeItem({ id: 'b', dayId: 'day3', pointId: 'p:shrine' }),
      ],
      places: [],
    }
    expect(nextDayFirstStopTitle(detail, DAYS[0]!, getPointPreview)).toBe('Uji Shrine')
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
    const driving = dayNavTargets(DAYS[1]!, legs, items, [PLACE], [], getPointPreview)
    expect(driving.map((target) => target.provider)).toEqual(['google', 'apple', 'amap'])
    expect(driving[0]!.url).toContain('travelmode=driving')
    expect(dayNavTargets(DAYS[0]!, legs, items, [PLACE], [], getPointPreview)[0]!.url).toContain('travelmode=transit')
    expect(dayNavTargets(DAYS[0]!, undefined, items, [PLACE], [], getPointPreview)).toEqual([])
  })

  it('dayNavStops：条目取显示名，住宿首尾按住宿区间取自定义点名（不按坐标匹配，G9）', () => {
    const hotelA: PlaceRecord = { ...PLACE, id: 'hotel-a', kind: 'lodging', title: 'Hotel A', lat: 34.9, lng: 135.7 }
    const hotelB: PlaceRecord = { ...PLACE, id: 'hotel-b', kind: 'lodging', title: '  ', lat: 34.95, lng: 135.75 }
    const lodgings: LodgingRecord[] = [
      // Day 2 退房 Hotel A，入住 Hotel B（换酒店日）
      { id: 'l1', routeBookId: 'rb1', placeId: 'hotel-a', fromDayIndex: 1, toDayIndex: 2, checkIn: null, checkOut: null, note: null },
      { id: 'l2', routeBookId: 'rb1', placeId: 'hotel-b', fromDayIndex: 2, toDayIndex: 3, checkIn: null, checkOut: null, note: null },
    ]
    // 住宿站坐标与 Uji Station 重合：旧实现会按坐标误匹配成 Uji Station
    const withLodging = {
      ...legs,
      stops: [
        { id: 'lodging:start', lat: 34.88, lng: 135.8, legMode: null },
        ...legs.stops,
        { id: 'lodging:end', lat: 34.88, lng: 135.8, legMode: null },
      ],
    } as DayLegsResult
    const places = [PLACE, hotelA, hotelB]
    expect(dayNavStops(DAYS[1]!, withLodging, items, places, lodgings, getPointPreview, 'zh').map((stop) => stop.name)).toEqual([
      'Hotel A',
      'Uji Shrine',
      'Uji Station',
      '住宿',
    ])
    // 没有住宿记录：住宿站一律用本地化默认名
    expect(dayNavStops(DAYS[1]!, withLodging, items, places, [], getPointPreview, 'en')[0]!.name).toBe('Lodging')
  })

  it('dayDateLabel 与 dayLabel 日期片段一致', () => {
    expect(dayDateLabel(DAYS[0]!, 'zh')).toMatch(/^9\/12 /)
    expect(dayLabel(DAYS[0]!, 1, 'zh')).toBe(`Day 1 · ${dayDateLabel(DAYS[0]!, 'zh')}`)
    expect(dayDateLabel(DAYS[1]!, 'zh')).toBeNull()
    expect(dayLabel(DAYS[1]!, 2, 'ja')).toBe('Day 2')
  })
})
