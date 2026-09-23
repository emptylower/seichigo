import { describe, expect, it } from 'vitest'
import type { Session } from 'next-auth'
import { buildDayStops, resolveDayLegs, LODGING_END_STOP_ID, LODGING_START_STOP_ID, type LegStop } from '@/lib/routeBook/legs'
import { createLegHandlers } from '@/lib/routeBook/handlers/legs'
import { InMemoryRouteBookRepo } from '@/lib/routeBook/repoMemory'
import { InMemoryPointPoolRepo } from '@/lib/pointPool/repoMemory'
import type { RouteBookApiDeps, } from '@/lib/routeBook/api'
import type { RouteBookItem, RouteBookLodging, RouteBookPlace } from '@/lib/routeBook/repo'

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

const COORDS = {
  nearA: { lat: 35.0000, lng: 135.0000 },
  nearB: { lat: 35.0027, lng: 135.0000 },
  farC: { lat: 35.0400, lng: 135.0500 },
}

const POINT_COORDS = new Map([
  ['p-near-a', COORDS.nearA],
  ['p-near-b', COORDS.nearB],
  ['p-far', COORDS.farC],
])

const HOTEL_PLACE: RouteBookPlace = { id: 'pl-hotel', routeBookId: 'rb-1', kind: 'lodging', title: '酒店', address: null, lat: 35.0010, lng: 135.0010, note: null, createdAt: new Date() }
const HOTEL_B_PLACE: RouteBookPlace = { id: 'pl-hotel-b', routeBookId: 'rb-1', kind: 'lodging', title: '酒店B', address: null, lat: 35.0300, lng: 135.0400, note: null, createdAt: new Date() }

const day = { id: 'd1', dayIndex: 2 }

describe('buildDayStops 住宿首尾', () => {
  const items = [
    item({ id: 'i-a', pointId: 'p-near-a', sortOrder: 0 }),
    item({ id: 'i-b', pointId: 'p-near-b', sortOrder: 1 }),
  ]

  it('无住宿：只有条目本身', () => {
    const { stops, agentLegs, staleTransitItemIds } = buildDayStops(day, items, [], [], POINT_COORDS)
    expect(stops.map((s) => s.id)).toEqual(['i-a', 'i-b'])
    expect(agentLegs.size).toBe(0)
    expect(staleTransitItemIds).toEqual([])
  })

  it('住中（from < d < to）：start=end 同一酒店', () => {
    const lodgings = [{ id: 'l1', routeBookId: 'rb-1', placeId: 'pl-hotel', fromDayIndex: 1, toDayIndex: 3, checkIn: null, checkOut: null, note: null }]
    const { stops } = buildDayStops(day, items, [HOTEL_PLACE], lodgings, POINT_COORDS)
    expect(stops.map((s) => s.id)).toEqual([LODGING_START_STOP_ID, 'i-a', 'i-b', LODGING_END_STOP_ID])
  })

  it('换酒店日（a 退房 + b 入住）：start/end 来自不同酒店', () => {
    const lodgings: RouteBookLodging[] = [
      { id: 'l1', routeBookId: 'rb-1', placeId: 'pl-hotel', fromDayIndex: 1, toDayIndex: 2, checkIn: null, checkOut: null, note: null },
      { id: 'l2', routeBookId: 'rb-1', placeId: 'pl-hotel-b', fromDayIndex: 2, toDayIndex: 4, checkIn: null, checkOut: null, note: null },
    ]
    const { stops } = buildDayStops(day, items, [HOTEL_PLACE, HOTEL_B_PLACE], lodgings, POINT_COORDS)
    expect(stops[0]).toMatchObject({ id: LODGING_START_STOP_ID, lat: HOTEL_PLACE.lat })
    expect(stops.at(-1)).toMatchObject({ id: LODGING_END_STOP_ID, lat: HOTEL_B_PLACE.lat })
  })

  it('入住日只有 end、退房日只有 start', () => {
    const lodgings: RouteBookLodging[] = [{ id: 'l1', routeBookId: 'rb-1', placeId: 'pl-hotel', fromDayIndex: 1, toDayIndex: 3, checkIn: null, checkOut: null, note: null }]
    const checkin = buildDayStops({ id: 'd1', dayIndex: 1 }, items, [HOTEL_PLACE], lodgings, POINT_COORDS)
    expect(checkin.stops.map((s) => s.id)).toEqual(['i-a', 'i-b', LODGING_END_STOP_ID])
    const checkout = buildDayStops({ id: 'd1', dayIndex: 3 }, items, [HOTEL_PLACE], lodgings, POINT_COORDS)
    expect(checkout.stops.map((s) => s.id)).toEqual([LODGING_START_STOP_ID, 'i-a', 'i-b'])
  })
})

describe('buildDayStops transit 接管与失效', () => {
  it('prev/next 对上 → payload.transport 登记到 agentLegs（key=nextItemId）；note 被跳过', () => {
    const items = [
      item({ id: 'i-a', pointId: 'p-near-a', sortOrder: 0 }),
      item({ id: 'i-note', kind: 'note', title: '备注', sortOrder: 1 }),
      item({
        id: 'i-t',
        kind: 'transit',
        title: '步行',
        sortOrder: 2,
        payload: {
          transitBetween: { prevItemId: 'i-a', nextItemId: 'i-b' },
          transport: { mode: 'walk', durationMin: 12, distanceKm: 0.9 },
        },
      }),
      item({ id: 'i-b', pointId: 'p-near-b', sortOrder: 3 }),
    ]

    const { stops, agentLegs, staleTransitItemIds } = buildDayStops(day, items, [], [], POINT_COORDS)
    expect(stops.map((s) => s.id)).toEqual(['i-a', 'i-b'])
    expect(staleTransitItemIds).toEqual([])
    expect(agentLegs.get('i-b')).toEqual({ mode: 'walk', durationMin: 12, distanceKm: 0.9 })
  })

  it('邻居错位（prevItemId 不再是前一站）→ 进 stale', () => {
    const items = [
      item({ id: 'i-a', pointId: 'p-near-a', sortOrder: 0 }),
      item({ id: 'i-b', pointId: 'p-near-b', sortOrder: 1 }),
      item({
        id: 'i-t',
        kind: 'transit',
        title: '过期交通',
        sortOrder: 2,
        payload: {
          transitBetween: { prevItemId: 'i-b', nextItemId: 'i-a' },
          transport: { mode: 'transit', durationMin: 20, distanceKm: 5 },
        },
      }),
    ]

    const { agentLegs, staleTransitItemIds } = buildDayStops(day, items, [], [], POINT_COORDS)
    expect(agentLegs.size).toBe(0)
    expect(staleTransitItemIds).toEqual(['i-t'])
  })

  it('无 payload.transport 的 transit 静默跳过（按普通段算），不进 stale', () => {
    const items = [
      item({ id: 'i-a', pointId: 'p-near-a', sortOrder: 0 }),
      item({
        id: 'i-t',
        kind: 'transit',
        title: '手工交通',
        sortOrder: 1,
        payload: { transitBetween: { prevItemId: 'i-a', nextItemId: 'i-b' } },
      }),
      item({ id: 'i-b', pointId: 'p-near-b', sortOrder: 2 }),
    ]

    const { stops, agentLegs, staleTransitItemIds } = buildDayStops(day, items, [], [], POINT_COORDS)
    expect(stops.map((s) => s.id)).toEqual(['i-a', 'i-b'])
    expect(agentLegs.size).toBe(0)
    expect(staleTransitItemIds).toEqual([])
  })

  it('无坐标点位不进停靠序列，也不参与 transit 邻居判定', () => {
    const items = [
      item({ id: 'i-ghost', pointId: 'p-unknown', sortOrder: 0 }),
      item({ id: 'i-a', pointId: 'p-near-a', sortOrder: 1 }),
    ]
    const { stops } = buildDayStops(day, items, [], [], POINT_COORDS)
    expect(stops.map((s) => s.id)).toEqual(['i-a'])
  })
})

describe('resolveDayLegs', () => {
  const stopsNear: LegStop[] = [
    { id: 'a', ...COORDS.nearA, legMode: null },
    { id: 'b', ...COORDS.nearB, legMode: null },
  ]

  it('agent 数据优先：durationMin×60、distanceKm×1000、mode 映射', async () => {
    const agentLegs = new Map([['b', { mode: 'drive', durationMin: 10, distanceKm: 4.5 }]])
    const legs = await resolveDayLegs(stopsNear, agentLegs, 'transit', async () => null)
    expect(legs).toHaveLength(1)
    expect(legs[0]).toMatchObject({
      fromId: 'a',
      toId: 'b',
      mode: 'driving',
      durationSec: 600,
      distanceM: 4500,
      source: 'agent',
      polyline: null,
    })
  })

  it('resolver 命中：采用其结果与请求 mode', async () => {
    const legs = await resolveDayLegs(stopsNear, new Map(), 'transit', async () => ({
      durationSec: 420,
      distanceM: 900,
      polyline: [[35.0, 135.0]],
      source: 'google' as const,
    }))
    expect(legs[0]).toMatchObject({ mode: 'transit', durationSec: 420, distanceM: 900, source: 'google', polyline: [[35.0, 135.0]] })
  })

  it('legMode 覆盖默认 mode；driving 启发式 = haversine/30km/h 且至少 5 分钟', async () => {
    const stops: LegStop[] = [
      { id: 'a', ...COORDS.nearA, legMode: null },
      { id: 'b', ...COORDS.nearB, legMode: 'driving' },
      { id: 'c', ...COORDS.farC, legMode: null },
    ]
    const calls: string[] = []
    const legs = await resolveDayLegs(stops, new Map(), 'transit', async (_from, _to, mode) => {
      calls.push(mode)
      return null
    })
    expect(calls).toEqual(['driving', 'transit'])
    expect(legs).toHaveLength(2)
    expect(legs[0]).toMatchObject({ mode: 'driving', source: 'heuristic', toId: 'b' })
    expect(legs[0]!.durationSec).toBeGreaterThanOrEqual(300)
    expect(legs[1]).toMatchObject({ mode: 'transit', source: 'heuristic', toId: 'c' })
  })

  it('heuristic：近距步行 / 远距公交，mode 以估算结果为准', async () => {
    const farStops: LegStop[] = [
      { id: 'a', ...COORDS.nearA, legMode: null },
      { id: 'c', ...COORDS.farC, legMode: null },
    ]
    const [walk] = await resolveDayLegs(stopsNear, new Map(), 'transit', async () => null)
    expect(walk).toMatchObject({ mode: 'walking', source: 'heuristic' })

    const [transit] = await resolveDayLegs(farStops, new Map(), 'walking', async () => null)
    expect(transit).toMatchObject({ mode: 'transit', source: 'heuristic' })
    expect(transit!.durationSec).toBeGreaterThanOrEqual(10 * 60)
  })
})

describe('legs handler', () => {
  function makeLegDeps(overrides?: Partial<RouteBookApiDeps>) {
    const pointBangumiMap = new Map([['p-near-a', 1], ['p-near-b', 1]])
    const repo = new InMemoryRouteBookRepo({ pointBangumiMap })
    const deps: RouteBookApiDeps = {
      repo,
      pointPoolRepo: new InMemoryPointPoolRepo({ pointBangumiMap }),
      getSession: async () => ({ user: { id: 'u1' } } as Session),
      now: () => new Date('2026-09-23T00:00:00.000Z'),
      pointCoords: async (ids) => {
        const map = new Map<string, { lat: number; lng: number }>()
        for (const id of ids) {
          const coords = POINT_COORDS.get(id)
          if (coords) map.set(id, coords)
        }
        return map
      },
      ...overrides,
    }
    return { repo, deps }
  }

  async function seedTwoPointDay(repo: InMemoryRouteBookRepo): Promise<{ bookId: string; dayId: string }> {
    const book = await repo.create('u1', '本', 'draft')
    const dayRow = (await repo.getById(book.id, 'u1'))!.days[0]!
    await repo.createItem(book.id, 'u1', { dayId: dayRow.id, kind: 'point', pointId: 'p-near-a' })
    await repo.createItem(book.id, 'u1', { dayId: dayRow.id, kind: 'point', pointId: 'p-near-b' })
    return { bookId: book.id, dayId: dayRow.id }
  }

  it('dayGeometry 有：注入整天几何后随响应返回（停靠序列与默认 mode 透传）', async () => {
    const calls: Array<{ stops: { lat: number; lng: number }[]; mode: string }> = []
    const geometry = { type: 'LineString' as const, coordinates: [[135.0, 35.0], [135.001, 35.0027]] as [number, number][] }
    const { repo, deps } = makeLegDeps({
      fetchDayGeometry: async (stops, mode) => {
        calls.push({ stops, mode })
        return geometry
      },
    })
    const { bookId, dayId } = await seedTwoPointDay(repo)

    const res = await createLegHandlers(deps).GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dayGeometry: typeof geometry | null; legs: unknown[] }
    expect(body.dayGeometry).toEqual(geometry)
    expect(body.legs).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.mode).toBe('transit')
    expect(calls[0]!.stops.map((s) => `${s.lat},${s.lng}`)).toEqual(['35,135', '35.0027,135'])
  })

  it('dayGeometry 无：未注入或 fetchDayGeometry 抛错 → null，不影响 legs', async () => {
    const plain = makeLegDeps()
    const { bookId, dayId } = await seedTwoPointDay(plain.repo)
    const plainRes = await createLegHandlers(plain.deps).GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    const plainBody = (await plainRes.json()) as { dayGeometry: unknown; legs: unknown[] }
    expect(plainBody.dayGeometry).toBeNull()
    expect(plainBody.legs).toHaveLength(1)

    const broken = makeLegDeps({
      fetchDayGeometry: async () => {
        throw new Error('mapbox down')
      },
    })
    const { bookId: bookId2, dayId: dayId2 } = await seedTwoPointDay(broken.repo)
    const brokenRes = await createLegHandlers(broken.deps).GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: bookId2, dayId: dayId2 }),
    })
    expect(brokenRes.status).toBe(200)
    const brokenBody = (await brokenRes.json()) as { dayGeometry: unknown; legs: unknown[] }
    expect(brokenBody.dayGeometry).toBeNull()
    expect(brokenBody.legs).toHaveLength(1)
  })
})
