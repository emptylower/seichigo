import { describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { buildDayStops, resolveDayLegs, LODGING_END_STOP_ID, LODGING_START_STOP_ID, type LegResolver, type LegStop } from '@/lib/routeBook/legs'
import { createLegHandlers } from '@/lib/routeBook/handlers/legs'
import { googleLegCacheRawKey } from '@/lib/routeBook/legResolverGoogle'
import { routeLegCacheKey } from '@/lib/routeBook/legCache'
import { InMemoryRouteBookRepo } from '@/lib/routeBook/repoMemory'
import { InMemoryPointPoolRepo } from '@/lib/pointPool/repoMemory'
import type { RouteBookApiDeps, } from '@/lib/routeBook/api'
import type { RouteBookItem, RouteBookLodging, RouteBookPlace } from '@/lib/routeBook/repo'

// B2 A2：批量缓存读替换为可控内存实现（routeLegCacheKey 保持真实 sha256）
const legCacheBatches = vi.hoisted(() => new Map<string, Prisma.JsonValue>())
vi.mock('@/lib/routeBook/legCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/routeBook/legCache')>()
  return {
    ...actual,
    getCachedLegs: vi.fn(async (keys: string[]) => {
      const out = new Map<string, Prisma.JsonValue>()
      for (const key of keys) {
        const hit = legCacheBatches.get(key)
        if (hit !== undefined) out.set(key, hit)
      }
      return out
    }),
  }
})

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

function makeLegDeps(overrides?: Partial<RouteBookApiDeps>) {
  const pointBangumiMap = new Map([['p-near-a', 1], ['p-near-b', 1]])
  const pointCoordsFake = async (ids: string[]) => {
    const map = new Map<string, { lat: number; lng: number }>()
    for (const id of ids) {
      const coords = POINT_COORDS.get(id)
      if (coords) map.set(id, coords)
    }
    return map
  }
  // A2：坐标并入 getDayContext，内存仓储注入同样的假实现
  const repo = new InMemoryRouteBookRepo({ pointBangumiMap, pointCoords: pointCoordsFake })
  const deps: RouteBookApiDeps = {
    repo,
    pointPoolRepo: new InMemoryPointPoolRepo({ pointBangumiMap }),
    getSession: async () => ({ user: { id: 'u1' } } as Session),
    now: () => new Date('2026-09-23T00:00:00.000Z'),
    pointCoords: pointCoordsFake,
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

  it('A3：目标停靠点显式设置 legMode → agent 段不被采用，transit 条目进 stale', () => {
    const items = [
      item({ id: 'i-a', pointId: 'p-near-a', sortOrder: 0 }),
      item({
        id: 'i-t',
        kind: 'transit',
        title: '公交',
        sortOrder: 1,
        payload: {
          transitBetween: { prevItemId: 'i-a', nextItemId: 'i-b' },
          transport: { mode: 'transit', durationMin: 20, distanceKm: 5 },
        },
      }),
      item({ id: 'i-b', pointId: 'p-near-b', sortOrder: 2, legMode: 'walking' }),
    ]

    const { stops, agentLegs, staleTransitItemIds } = buildDayStops(day, items, [], [], POINT_COORDS)
    expect(stops.map((s) => s.id)).toEqual(['i-a', 'i-b'])
    expect(stops[1]).toMatchObject({ id: 'i-b', legMode: 'walking' })
    expect(agentLegs.size).toBe(0)
    expect(staleTransitItemIds).toEqual(['i-t'])
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

  it('A2：显式 legMode 不被启发式改写——远距 walking 保持 walking（按 4.5km/h 估算）', async () => {
    const stops: LegStop[] = [
      { id: 'a', ...COORDS.nearA, legMode: null },
      { id: 'c', ...COORDS.farC, legMode: 'walking' },
    ]
    const modes: string[] = []
    const legs = await resolveDayLegs(stops, new Map(), 'transit', async (_from, _to, mode) => {
      modes.push(mode)
      return null
    })
    expect(modes).toEqual(['walking'])
    // nearA→farC 约 6.3km：步行估算 ≈ 84 分钟；若被启发式改写成 transit 只有约 27 分钟
    expect(legs[0]).toMatchObject({ mode: 'walking', source: 'heuristic', toId: 'c' })
    expect(legs[0]!.durationSec).toBeGreaterThan(60 * 60)
  })

  it('A2：显式 legMode transit 近距也保持 transit（25km/h + 12 分钟换乘）', async () => {
    const stops: LegStop[] = [
      { id: 'a', ...COORDS.nearA, legMode: null },
      { id: 'b', ...COORDS.nearB, legMode: 'transit' },
    ]
    const legs = await resolveDayLegs(stops, new Map(), 'walking', async () => null)
    expect(legs[0]).toMatchObject({ mode: 'transit', source: 'heuristic', toId: 'b' })
    expect(legs[0]!.durationSec).toBeGreaterThanOrEqual(12 * 60)
  })

  it('A3：显式 legMode 覆盖 agent 数据——agentLegs 有该段也不用', async () => {
    const stops: LegStop[] = [
      { id: 'a', ...COORDS.nearA, legMode: null },
      { id: 'b', ...COORDS.nearB, legMode: 'walking' },
    ]
    const agentLegs = new Map([['b', { mode: 'transit', durationMin: 20, distanceKm: 5 }]])
    const legs = await resolveDayLegs(stops, agentLegs, 'transit', async () => null)
    expect(legs[0]).toMatchObject({ mode: 'walking', source: 'heuristic', toId: 'b' })
    expect(legs[0]!.durationSec).toBeLessThan(20 * 60)
  })
})

describe('legs handler', () => {
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
    expect(res.headers.get('cache-control')).toBe('private, max-age=0')
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

  it('getDayContext：外本 dayId / 别人的本 / 不存在的天或本 → 404', async () => {
    const { repo, deps } = makeLegDeps()
    const mine = await seedTwoPointDay(repo)
    const otherBook = await repo.create('u1', '另一本', 'draft')
    const otherDay = (await repo.getById(otherBook.id, 'u1'))!.days[0]!
    const strangerBook = await repo.create('u2', '别人的本', 'draft')
    const strangerDay = (await repo.getById(strangerBook.id, 'u2'))!.days[0]!

    const get = (id: string, dayId: string) =>
      createLegHandlers(deps).GET(new Request('http://localhost/x'), { params: Promise.resolve({ id, dayId }) })

    expect((await get(mine.bookId, otherDay.id)).status).toBe(404)
    expect((await get(strangerBook.id, strangerDay.id)).status).toBe(404)
    expect((await get(mine.bookId, 'day-不存在')).status).toBe(404)
    expect((await get('rb-不存在', mine.dayId)).status).toBe(404)
  })

  it('带 sig 命中缓存：直接用缓存的 dayGeometry，不再调 Mapbox 路径', async () => {
    const geometry = { type: 'LineString' as const, coordinates: [[135.0, 35.0], [135.001, 35.0027]] as [number, number][] }
    const geometryCalls: unknown[] = []
    const sigCalls: Array<{ dayId: string; sig: string }> = []
    const { repo, deps } = makeLegDeps({
      readDayGeometryBySig: async (dayId, sig) => {
        sigCalls.push({ dayId, sig })
        return geometry
      },
      fetchDayGeometry: async () => {
        geometryCalls.push('should-not-happen')
        return null
      },
    })
    const { bookId, dayId } = await seedTwoPointDay(repo)

    const res = await createLegHandlers(deps).GET(new Request(`http://localhost/x?sig=abc123`), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dayGeometry: typeof geometry | null; legs: unknown[] }
    expect(body.dayGeometry).toEqual(geometry)
    expect(body.legs).toHaveLength(1)
    expect(sigCalls).toEqual([{ dayId, sig: 'abc123' }])
    expect(geometryCalls).toHaveLength(0)
  })

  it('不带 sig 走原流程：不读 sig 缓存，fetchDayGeometry 收到 sigCache=undefined', async () => {
    const geometry = { type: 'LineString' as const, coordinates: [[135.0, 35.0], [135.001, 35.0027]] as [number, number][] }
    const sigCalls: unknown[] = []
    const geometrySigCaches: Array<{ dayId: string; sig: string } | undefined> = []
    const { repo, deps } = makeLegDeps({
      readDayGeometryBySig: async () => {
        sigCalls.push('should-not-happen')
        return geometry
      },
      fetchDayGeometry: async (_stops, _mode, sigCache) => {
        geometrySigCaches.push(sigCache)
        return geometry
      },
    })
    const { bookId, dayId } = await seedTwoPointDay(repo)

    const res = await createLegHandlers(deps).GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dayGeometry: typeof geometry | null }
    expect(body.dayGeometry).toEqual(geometry)
    expect(sigCalls).toHaveLength(0)
    expect(geometrySigCaches).toEqual([undefined])
  })

  it('带 sig 未命中：走 fetchDayGeometry 并透传 sigCache（供双 key 回填）；sig 截 64 字符', async () => {
    const geometry = { type: 'LineString' as const, coordinates: [[135.0, 35.0], [135.001, 35.0027]] as [number, number][] }
    const sigCalls: Array<{ dayId: string; sig: string }> = []
    const geometrySigCaches: Array<{ dayId: string; sig: string } | undefined> = []
    const { repo, deps } = makeLegDeps({
      readDayGeometryBySig: async (dayId, sig) => {
        sigCalls.push({ dayId, sig })
        return null
      },
      fetchDayGeometry: async (_stops, _mode, sigCache) => {
        geometrySigCaches.push(sigCache)
        return geometry
      },
    })
    const { bookId, dayId } = await seedTwoPointDay(repo)
    const longSig = 'x'.repeat(80)

    const res = await createLegHandlers(deps).GET(new Request(`http://localhost/x?sig=${longSig}`), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dayGeometry: typeof geometry | null }
    expect(body.dayGeometry).toEqual(geometry)
    expect(sigCalls).toEqual([{ dayId, sig: 'x'.repeat(64) }])
    expect(geometrySigCaches).toEqual([{ dayId, sig: 'x'.repeat(64) }])
  })
})

describe('legs handler B2 A2（Google 段池）', () => {
  const GOOGLE_LEG = { durationSec: 421, distanceM: 812, polyline: [[35.0, 135.0]] as [number, number][], source: 'google' as const }

  /** 用 place 造 n 个停靠点（坐标任意，不受点位表约束） */
  async function seedPlaceDay(repo: InMemoryRouteBookRepo, count: number): Promise<{ bookId: string; dayId: string }> {
    const book = await repo.create('u1', '本', 'draft')
    const dayRow = (await repo.getById(book.id, 'u1'))!.days[0]!
    for (let i = 0; i < count; i++) {
      const place = await repo.createPlace(book.id, 'u1', {
        kind: 'other',
        title: `地点${i}`,
        lat: 35 + i * 0.003,
        lng: 135 + i * 0.003,
      })
      await repo.createItem(book.id, 'u1', { dayId: dayRow.id, kind: 'place', placeId: place.id })
    }
    return { bookId: book.id, dayId: dayRow.id }
  }

  function flushMicrotasks() {
    return Promise.resolve().then(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve()
    })
  }

  it('deps.legResolver 默认接线：createLegHandlers(deps) 不传 resolver 也走 deps 注入的实现', async () => {
    const calls: number[] = []
    const { repo, deps } = makeLegDeps({
      legResolver: async (_from, _to, mode) => {
        calls.push(1)
        expect(mode).toBe('transit')
        return GOOGLE_LEG
      },
    })
    const { bookId, dayId } = await seedTwoPointDay(repo)

    const res = await createLegHandlers(deps, undefined, { rateLimitMax: 1000 }).GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { legs: Array<typeof GOOGLE_LEG & { fromId: string; toId: string; mode: string }> }
    expect(body.legs).toHaveLength(1)
    expect(body.legs[0]).toMatchObject({ ...GOOGLE_LEG, mode: 'transit' })
    expect(calls).toHaveLength(1)
  })

  it('批量缓存命中：不再调 Google resolver，直接用缓存段', async () => {
    const raw = googleLegCacheRawKey('transit', COORDS.nearA, COORDS.nearB)
    legCacheBatches.set(routeLegCacheKey(raw), { durationSec: 321, distanceM: 654, polyline: null, source: 'google' })
    const resolver = vi.fn(async () => GOOGLE_LEG) as unknown as LegResolver
    const { repo, deps } = makeLegDeps({ legResolver: resolver })
    const { bookId, dayId } = await seedTwoPointDay(repo)

    const res = await createLegHandlers(deps, undefined, { rateLimitMax: 1000 }).GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { legs: Array<{ durationSec: number; source: string }> }
    expect(body.legs[0]).toMatchObject({ durationSec: 321, distanceM: 654, source: 'google' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('缓存里的脏 payload（source 非 google）按未命中：照常调 resolver', async () => {
    const raw = googleLegCacheRawKey('transit', COORDS.nearA, COORDS.nearB)
    legCacheBatches.set(routeLegCacheKey(raw), { durationSec: 1, distanceM: 1, source: 'heuristic' })
    const { repo, deps } = makeLegDeps({ legResolver: async () => GOOGLE_LEG })
    const { bookId, dayId } = await seedTwoPointDay(repo)

    const res = await createLegHandlers(deps, undefined, { rateLimitMax: 1000 }).GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    const body = (await res.json()) as { legs: Array<{ source: string }> }
    expect(body.legs[0]).toMatchObject({ source: 'google', durationSec: 421 })
  })

  it('未命中的段并发上限 4：第 5 段要等前面释放槽位才进入', async () => {
    const gates: Array<() => void> = []
    let started = 0
    const legResolver: LegResolver = () => {
      started++
      return new Promise((resolve) => {
        gates.push(() => resolve(GOOGLE_LEG))
      })
    }
    const { repo, deps } = makeLegDeps({ legResolver })
    const { bookId, dayId } = await seedPlaceDay(repo, 6) // 6 站 → 5 段

    const promise = createLegHandlers(deps, undefined, { rateLimitMax: 1000 }).GET(new Request('http://localhost/x'), {
      params: Promise.resolve({ id: bookId, dayId }),
    })
    await flushMicrotasks()
    expect(started).toBe(4)

    gates[0]!()
    await flushMicrotasks()
    expect(started).toBe(5)

    for (const gate of gates.slice(1)) gate()
    const res = await promise
    expect(res.status).toBe(200)
    const body = (await res.json()) as { legs: Array<{ source: string }> }
    expect(body.legs).toHaveLength(5)
    expect(body.legs.every((leg) => leg.source === 'google')).toBe(true)
  })

  it('整体 8 秒截止：超时的段降级 heuristic', async () => {
    vi.useFakeTimers()
    try {
      const never: LegResolver = () => new Promise(() => {})
      const { repo, deps } = makeLegDeps({ legResolver: never })
      const { bookId, dayId } = await seedTwoPointDay(repo)

      const promise = createLegHandlers(deps, undefined, { rateLimitMax: 1000 }).GET(new Request('http://localhost/x'), {
        params: Promise.resolve({ id: bookId, dayId }),
      })
      await flushMicrotasks()
      vi.advanceTimersByTime(8_000)
      const res = await promise
      expect(res.status).toBe(200)
      const body = (await res.json()) as { legs: Array<{ source: string; mode: string }> }
      expect(body.legs).toHaveLength(1)
      expect(body.legs[0]).toMatchObject({ source: 'heuristic' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('每用户每分钟 10 次限流，超出 429', async () => {
    const { deps } = makeLegDeps({
      getSession: async () => ({ user: { id: 'u-legs-rate' } } as Session),
    })
    const book = await deps.repo.create('u-legs-rate', '本', 'draft')
    const dayRow = (await deps.repo.getById(book.id, 'u-legs-rate'))!.days[0]!

    const handlers = createLegHandlers(deps)
    const get = () => handlers.GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: book.id, dayId: dayRow.id }) })

    for (let i = 0; i < 10; i++) {
      const res = await get()
      expect(res.status).toBe(200)
    }
    const limited = await get()
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: '请求过于频繁，请稍后再试' })
  })
})
