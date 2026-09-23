import { describe, expect, it } from 'vitest'
import type { Session } from 'next-auth'
import { InMemoryRouteBookRepo } from '@/lib/routeBook/repoMemory'
import { InMemoryPointPoolRepo } from '@/lib/pointPool/repoMemory'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import type { RouteBookDetail } from '@/lib/routeBook/repo'
import { createHandlers as createRouteBookHandlers } from '@/lib/routeBook/handlers/routebooks'
import { createHandlers as createPointsHandlers } from '@/lib/routeBook/handlers/routebookPoints'
import { createItemHandlers } from '@/lib/routeBook/handlers/items'
import { createDayHandlers } from '@/lib/routeBook/handlers/days'
import { createPlaceHandlers } from '@/lib/routeBook/handlers/places'
import { createPlaceIntroHandlers } from '@/lib/routeBook/handlers/placeIntro'
import { createLodgingHandlers } from '@/lib/routeBook/handlers/lodgings'
import { createOptimizeHandlers } from '@/lib/routeBook/handlers/optimize'

const POINT_COORDS: Record<string, { lat: number; lng: number }> = {
  p1: { lat: 35.010, lng: 135.760 },
  p2: { lat: 35.012, lng: 135.770 },
  p3: { lat: 35.008, lng: 135.780 },
  p4: { lat: 35.030, lng: 135.765 },
}

function makeDeps(userId = 'u1') {
  const pointBangumiMap = new Map<string, number>([
    ['p1', 1],
    ['p2', 1],
    ['p3', 2],
    ['p4', 2],
    ['p5', 3],
  ])
  let seq = 0
  let tick = 0
  const repo = new InMemoryRouteBookRepo({
    pointBangumiMap,
    idFactory: () => `id-${++seq}`,
    now: () => new Date(Date.parse('2026-09-23T00:00:00.000Z') + tick++ * 1000),
  })
  const pointPoolRepo = new InMemoryPointPoolRepo({ pointBangumiMap })
  const deps: RouteBookApiDeps = {
    repo,
    pointPoolRepo,
    getSession: async () => ({ user: { id: userId } } as Session),
    now: () => new Date('2026-09-23T00:00:00.000Z'),
    pointCoords: async (pointIds) => {
      const map = new Map<string, { lat: number; lng: number }>()
      for (const id of pointIds) {
        const coords = POINT_COORDS[id]
        if (coords) map.set(id, coords)
      }
      return map
    },
  }
  return { repo, pointPoolRepo, deps }
}

function req(url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) }
}

async function setupBook(deps: RouteBookApiDeps, dayCount = 2): Promise<RouteBookDetail> {
  const bookHandlers = createRouteBookHandlers(deps)
  const res = await bookHandlers.POST(req('/api/me/routebooks', 'POST', { title: '本', dayCount }))
  const body = (await res.json()) as { routeBook: { id: string } }
  const detail = await deps.repo.getById(body.routeBook.id, 'u1')
  if (!detail) throw new Error('book not created')
  return detail
}

describe('routebook handlers 鉴权与归属', () => {
  it('未登录 401；别人的行程本 404（仓储按 userId 过滤）', async () => {
    const { repo, deps } = makeDeps('u1')
    const detail = await setupBook(deps)

    const anonDeps: RouteBookApiDeps = { ...deps, getSession: async () => null }
    const itemHandlers = createItemHandlers(anonDeps)
    const unauthorized = await itemHandlers.POST(req('/x', 'POST', { dayId: null, kind: 'note', title: 'x' }), ctx({ id: detail.id }))
    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).toEqual({ error: '请先登录' })

    const otherDeps: RouteBookApiDeps = { ...deps, getSession: async () => ({ user: { id: 'u2' } } as Session) }
    const otherHandlers = createItemHandlers(otherDeps)
    const foreign = await otherHandlers.POST(
      req('/x', 'POST', { dayId: null, kind: 'note', title: 'x' }),
      ctx({ id: detail.id })
    )
    expect(foreign.status).toBe(404)
    expect(await repo.listByUser('u2')).toHaveLength(0)
  })
})

describe('routebook items handlers', () => {
  it('增删改 + 点位池同步语义', async () => {
    const { repo, pointPoolRepo, deps } = makeDeps()
    const detail = await setupBook(deps)
    const day1 = detail.days[0]!
    const handlers = createItemHandlers(deps)

    await pointPoolRepo.upsert('u1', 'p1')
    const created = await handlers.POST(
      req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId: 'p1', title: '车站' }),
      ctx({ id: detail.id })
    )
    expect(created.status).toBe(200)
    const item = ((await created.json()) as { item: { id: string } }).item
    expect(await pointPoolRepo.has('u1', 'p1')).toBe(false)

    const patched = await handlers.PATCH(
      req('/x', 'PATCH', { note: '开场', timeStart: '09:00' }),
      ctx({ id: detail.id, itemId: item.id })
    )
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { item: { note: string; timeStart: string } }).item).toMatchObject({
      note: '开场',
      timeStart: '09:00',
    })

    const removed = await handlers.DELETE(req('/x', 'DELETE'), ctx({ id: detail.id, itemId: item.id }))
    expect(removed.status).toBe(200)
    expect(await pointPoolRepo.has('u1', 'p1')).toBe(true)
    expect(await repo.isPointInAnyRouteBook('u1', 'p1')).toBe(false)
  })

  it('reorder 天内/跨天/未安排↔天；缺条目 400；25 上限 400', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const day1 = detail.days[0]!
    const day2 = detail.days[1]!
    const handlers = createItemHandlers(deps)

    const mk = async (dayId: string | null, pointId: string) => {
      const res = await handlers.POST(req('/x', 'POST', { dayId, kind: 'point', pointId }), ctx({ id: detail.id }))
      expect(res.status).toBe(200)
      return ((await res.json()) as { item: { id: string } }).item.id
    }
    const a = await mk(day1.id, 'p1')
    const b = await mk(day1.id, 'p2')
    const c = await mk(day1.id, 'p3')

    let res = await handlers.REORDER(req('/x', 'POST', { dayId: day1.id, orderedItemIds: [c, a, b] }), ctx({ id: detail.id }))
    expect(res.status).toBe(200)
    let body = (await res.json()) as { items: { id: string; dayId: string | null }[] }
    expect(body.items.filter((i) => i.dayId === day1.id).map((i) => i.id)).toEqual([c, a, b])

    res = await handlers.REORDER(req('/x', 'POST', { dayId: day2.id, orderedItemIds: [c] }), ctx({ id: detail.id }))
    expect(res.status).toBe(200)
    body = (await res.json()) as typeof body
    expect(body.items.find((i) => i.id === c)?.dayId).toBe(day2.id)

    // 未安排 → 天
    const u = await (async () => {
      const r = await handlers.POST(req('/x', 'POST', { dayId: null, kind: 'note', title: '未安排' }), ctx({ id: detail.id }))
      return ((await r.json()) as { item: { id: string } }).item.id
    })()
    res = await handlers.REORDER(req('/x', 'POST', { dayId: day1.id, orderedItemIds: [a, u, b] }), ctx({ id: detail.id }))
    expect(res.status).toBe(200)

    // 缺条目 → 400
    res = await handlers.REORDER(req('/x', 'POST', { dayId: day1.id, orderedItemIds: [a] }), ctx({ id: detail.id }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: '列表与当前条目不一致，请刷新' })
  })

  it('每天 25 条上限只数 point/place，超出 400', async () => {
    const { deps } = makeDeps()
    const book = await setupBook(deps)
    const day1 = book.days[0]!
    const itemHandlers = createItemHandlers(deps)
    const placeHandlers = createPlaceHandlers(deps)

    // 5 个 point（同天幂等，各 1 条）+ 20 个 place 条目 = 25 个计数条目
    for (const pointId of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      const r = await itemHandlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId }), ctx({ id: book.id }))
      expect(r.status).toBe(200)
    }
    for (let i = 0; i < 20; i++) {
      const r = await placeHandlers.POST(
        req('/x', 'POST', { kind: 'other', title: `地点${i}`, lat: 35, lng: 135 }),
        ctx({ id: book.id })
      )
      const placeId = ((await r.json()) as { place: { id: string } }).place.id
      const ir = await itemHandlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'place', placeId }), ctx({ id: book.id }))
      expect(ir.status).toBe(200)
    }
    // note 不占额
    const noteRes = await itemHandlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'note', title: '备注' }), ctx({ id: book.id }))
    expect(noteRes.status).toBe(200)

    // 第 26 个计数条目 → 400
    const extraRes = await placeHandlers.POST(
      req('/x', 'POST', { kind: 'other', title: '超限', lat: 35, lng: 135 }),
      ctx({ id: book.id })
    )
    const extraPlaceId = ((await extraRes.json()) as { place: { id: string } }).place.id
    const limitRes = await itemHandlers.POST(
      req('/x', 'POST', { dayId: day1.id, kind: 'place', placeId: extraPlaceId }),
      ctx({ id: book.id })
    )
    expect(limitRes.status).toBe(400)
    expect(await limitRes.json()).toMatchObject({ error: '这一天最多 25 条', reason: 'day_limit' })
  })

  it('锚顺序冲突 → 409 且返回中文消息', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const day1 = detail.days[0]!
    const handlers = createItemHandlers(deps)

    const early = ((await (await handlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId: 'p1', title: '早' }), ctx({ id: detail.id }))).json()) as { item: { id: string } }).item.id
    const late = ((await (await handlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId: 'p2', title: '晚' }), ctx({ id: detail.id }))).json()) as { item: { id: string } }).item.id
    await handlers.PATCH(req('/x', 'PATCH', { timeStart: '09:00', locked: true }), ctx({ id: detail.id, itemId: early }))
    await handlers.PATCH(req('/x', 'PATCH', { timeStart: '10:00', locked: true }), ctx({ id: detail.id, itemId: late }))

    const res = await handlers.REORDER(req('/x', 'POST', { dayId: day1.id, orderedItemIds: [late, early] }), ctx({ id: detail.id }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: '「早」(09:00) 必须排在「晚」(10:00) 之后',
      reason: 'anchor_order',
    })
  })
})

describe('/points 兼容壳', () => {
  it('POST 加入未安排并移出点位池；DELETE 全删并可回池；PATCH 410', async () => {
    const { pointPoolRepo, deps } = makeDeps()
    const detail = await setupBook(deps)
    await setupBook(deps) // 第二本（验证 isPointInAnyRouteBook 跨本）
    const handlers = createPointsHandlers(deps)

    await pointPoolRepo.upsert('u1', 'p1')
    const addRes = await handlers.POST(req('/x', 'POST', { pointId: 'p1' }), ctx({ id: detail.id }))
    expect(addRes.status).toBe(200)
    expect(((await addRes.json()) as { item: { dayId: string | null; kind: string } }).item).toMatchObject({
      dayId: null,
      kind: 'point',
    })
    expect(await pointPoolRepo.has('u1', 'p1')).toBe(false)

    // 同一点位在另一本也存在时 DELETE 不回池
    const other = (await deps.repo.listByUser('u1')).find((book) => book.id !== detail.id)!
    await deps.repo.createItem(other.id, 'u1', { dayId: null, kind: 'point', pointId: 'p1' })
    await handlers.DELETE(req('/x', 'DELETE', { pointId: 'p1' }), ctx({ id: detail.id }))
    expect(await pointPoolRepo.has('u1', 'p1')).toBe(false)
    await deps.repo.createItem(detail.id, 'u1', { dayId: null, kind: 'point', pointId: 'p1' })
    await deps.repo.deleteItem(other.id, 'u1', (await deps.repo.getById(other.id, 'u1'))!.items[0]!.id)

    // 现在只剩本 detail 引用 → DELETE 后回池
    await handlers.DELETE(req('/x', 'DELETE', { pointId: 'p1' }), ctx({ id: detail.id }))
    expect(await pointPoolRepo.has('u1', 'p1')).toBe(true)

    const gone = await handlers.PATCH(req('/x', 'PATCH', { pointId: 'p1', zone: 'sorted' }), ctx({ id: detail.id }))
    expect(gone.status).toBe(410)
    expect(await gone.json()).toEqual({ error: '接口已升级，请刷新页面' })
  })
})

describe('routebook days/places/lodgings handlers', () => {
  it('days 插入/删除/重排', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const handlers = createDayHandlers(deps)

    const inserted = await handlers.POST(req('/x', 'POST', { afterDayIndex: 1 }), ctx({ id: detail.id }))
    expect(inserted.status).toBe(200)
    const newDay = ((await inserted.json()) as { day: { id: string; dayIndex: number } }).day
    expect(newDay.dayIndex).toBe(2)

    const reordered = await handlers.REORDER(
      req('/x', 'POST', { orderedDayIds: [newDay.id, detail.days[0]!.id, detail.days[1]!.id] }),
      ctx({ id: detail.id })
    )
    expect(reordered.status).toBe(200)
    expect(((await reordered.json()) as { days: { id: string }[] }).days.map((d) => d.id)).toEqual([
      newDay.id,
      detail.days[0]!.id,
      detail.days[1]!.id,
    ])

    const patched = await handlers.PATCH(req('/x', 'PATCH', { title: '宇治日', defaultTravelMode: 'walking' }), ctx({ id: detail.id, dayId: newDay.id }))
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { day: { title: string; defaultTravelMode: string } }).day).toMatchObject({
      title: '宇治日',
      defaultTravelMode: 'walking',
    })

    const removed = await handlers.DELETE(req('/x', 'DELETE'), ctx({ id: detail.id, dayId: newDay.id }))
    expect(removed.status).toBe(200)
    expect((await deps.repo.getById(detail.id, 'u1'))!.days).toHaveLength(2)
  })

  it('places 级联；lodgings 重叠 400', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const day1 = detail.days[0]!
    const placeHandlers = createPlaceHandlers(deps)
    const lodgingHandlers = createLodgingHandlers(deps)
    const itemHandlers = createItemHandlers(deps)

    const hotelRes = await placeHandlers.POST(
      req('/x', 'POST', { kind: 'lodging', title: '酒店', lat: 35.01, lng: 135.77 }),
      ctx({ id: detail.id })
    )
    const hotel = ((await hotelRes.json()) as { place: { id: string } }).place.id
    await lodgingHandlers.POST(req('/x', 'POST', { placeId: hotel, fromDayIndex: 1, toDayIndex: 2 }), ctx({ id: detail.id }))
    await itemHandlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'place', placeId: hotel }), ctx({ id: detail.id }))

    const overlap = await lodgingHandlers.POST(
      req('/x', 'POST', { placeId: hotel, fromDayIndex: 1, toDayIndex: 2 }),
      ctx({ id: detail.id })
    )
    expect(overlap.status).toBe(400)
    expect(await overlap.json()).toMatchObject({ error: '住宿日期与已有住宿重叠', reason: 'lodging_overlap' })

    const removed = await placeHandlers.DELETE(req('/x', 'DELETE'), ctx({ id: detail.id, placeId: hotel }))
    expect(removed.status).toBe(200)
    const after = await deps.repo.getById(detail.id, 'u1')
    expect(after!.places).toHaveLength(0)
    expect(after!.lodgings).toHaveLength(0)
    expect(after!.items.some((item) => item.placeId === hotel)).toBe(false)
  })

  it('PATCH 行程本乐观锁 409', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const handlers = createRouteBookHandlers(deps)

    const staleRes = await handlers.PATCH(
      req('/x', 'PATCH', { title: '改名', updatedAt: new Date(0).toISOString() }),
      ctx({ id: detail.id })
    )
    expect(staleRes.status).toBe(409)
    expect(await staleRes.json()).toMatchObject({ error: '行程已在别处修改，请刷新', reason: 'stale' })

    const freshRes = await handlers.PATCH(
      req('/x', 'PATCH', { title: '改名', startDate: '2026-10-01T00:00:00.000Z', dayCount: 3, updatedAt: detail.updatedAt.toISOString() }),
      ctx({ id: detail.id })
    )
    expect(freshRes.status).toBe(200)
    const updated = (await freshRes.json()) as { routeBook: { title: string; dayCount: number } }
    expect(updated.routeBook).toMatchObject({ title: '改名', dayCount: 3 })
    expect((await deps.repo.getById(detail.id, 'u1'))!.days).toHaveLength(3)
  })
})

describe('placeIntro handler', () => {
  it('未登录 401；行程本不存在 404；place 不属于本 404；无 googlePlaceId 404（该地点暂无谷歌信息）', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const placeHandlers = createPlaceHandlers(deps)
    const created = await placeHandlers.POST(
      req('/x', 'POST', { kind: 'other', title: '手工点', lat: 35, lng: 135 }),
      ctx({ id: detail.id })
    )
    const placeId = ((await created.json()) as { place: { id: string } }).place.id

    const anon = createPlaceIntroHandlers({ ...deps, getSession: async () => null })
    const unauthorized = await anon.GET(req('/x', 'GET'), ctx({ id: detail.id, placeId }))
    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).toEqual({ error: '请先登录' })

    const handlers = createPlaceIntroHandlers(deps)
    const noBook = await handlers.GET(req('/x', 'GET'), ctx({ id: 'nope', placeId }))
    expect(noBook.status).toBe(404)
    expect(await noBook.json()).toEqual({ error: '行程不存在' })

    const noPlace = await handlers.GET(req('/x', 'GET'), ctx({ id: detail.id, placeId: 'nope' }))
    expect(noPlace.status).toBe(404)
    expect(await noPlace.json()).toEqual({ error: '自定义点不存在' })

    const noGoogle = await handlers.GET(req('/x', 'GET'), ctx({ id: detail.id, placeId }))
    expect(noGoogle.status).toBe(404)
    expect(await noGoogle.json()).toEqual({ error: '该地点暂无谷歌信息' })
  })

  it('上游无结果 404；成功 200 返回 intro；lang 缺省 zh-CN、非法 lang 400', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const placeHandlers = createPlaceHandlers(deps)
    const created = await placeHandlers.POST(
      req('/x', 'POST', { kind: 'restaurant', title: '食堂', lat: 35, lng: 135, googlePlaceId: 'gp-1' }),
      ctx({ id: detail.id })
    )
    const placeId = ((await created.json()) as { place: { id: string; googlePlaceId: string | null } }).place.id
    const missCreated = await placeHandlers.POST(
      req('/x', 'POST', { kind: 'other', title: '无介绍点', lat: 35, lng: 135, googlePlaceId: 'gp-miss' }),
      ctx({ id: detail.id })
    )
    const missPlaceId = ((await missCreated.json()) as { place: { id: string } }).place.id

    const calls: Array<{ placeId: string; lang: string }> = []
    const handlers = createPlaceIntroHandlers({
      ...deps,
      placeIntro: async (googlePlaceId, lang) => {
        calls.push({ placeId: googlePlaceId, lang })
        if (googlePlaceId !== 'gp-1') return null
        return {
          name: '宇治食堂',
          address: '京都府宇治市',
          rating: 4.3,
          userRatingsTotal: 1234,
          summary: '抹茶名店',
          openingHours: ['星期一: 10:00 – 18:00'],
          website: null,
          mapsUrl: 'https://maps.google.com/?cid=1',
        }
      },
    })

    const miss = await handlers.GET(req('/x', 'GET'), ctx({ id: detail.id, placeId: missPlaceId }))
    expect(miss.status).toBe(404)
    expect(await miss.json()).toEqual({ error: '该地点暂无谷歌信息' })

    const badLang = await handlers.GET(req('/x?lang=fr', 'GET'), ctx({ id: detail.id, placeId }))
    expect(badLang.status).toBe(400)

    const ok = await handlers.GET(req('/x', 'GET'), ctx({ id: detail.id, placeId }))
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ok: boolean; intro: { name: string; rating: number } }
    expect(body.ok).toBe(true)
    expect(body.intro).toMatchObject({ name: '宇治食堂', rating: 4.3 })
    expect(calls).toEqual([
      { placeId: 'gp-miss', lang: 'zh-CN' },
      { placeId: 'gp-1', lang: 'zh-CN' },
    ])

    const en = await handlers.GET(req('/x?lang=en', 'GET'), ctx({ id: detail.id, placeId }))
    expect(en.status).toBe(200)
    expect(calls.at(-1)).toEqual({ placeId: 'gp-1', lang: 'en' })
  })

  it('每用户每分钟 30 次限流，超出 429', async () => {
    const { deps } = makeDeps('u-rate')
    const book = await deps.repo.create('u-rate', '本', 'draft')
    const detail = (await deps.repo.getById(book.id, 'u-rate'))!
    const placeHandlers = createPlaceHandlers(deps)
    const created = await placeHandlers.POST(
      req('/x', 'POST', { kind: 'other', title: '点', lat: 35, lng: 135, googlePlaceId: 'gp-1' }),
      ctx({ id: detail.id })
    )
    const placeId = ((await created.json()) as { place: { id: string } }).place.id
    const handlers = createPlaceIntroHandlers({
      ...deps,
      placeIntro: async () => ({ name: 'x', address: null, rating: null, userRatingsTotal: null, summary: null, openingHours: [], website: null, mapsUrl: null }),
    })

    for (let i = 0; i < 30; i++) {
      const res = await handlers.GET(req('/x', 'GET'), ctx({ id: detail.id, placeId }))
      expect(res.status).toBe(200)
    }
    const limited = await handlers.GET(req('/x', 'GET'), ctx({ id: detail.id, placeId }))
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: '请求过于频繁，请稍后再试' })
  })
})

describe('routebook optimize handler', () => {
  it('返回优化顺序并写回，锁定/无坐标条目不动', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const day1 = detail.days[0]!
    const itemHandlers = createItemHandlers(deps)
    const optimizeHandlers = createOptimizeHandlers(deps)

    const mk = async (dayId: string | null, body: Record<string, unknown>) => {
      const res = await itemHandlers.POST(req('/x', 'POST', { dayId, ...body }), ctx({ id: detail.id }))
      expect(res.status).toBe(200)
      return ((await res.json()) as { item: { id: string } }).item.id
    }

    // p1/p2/p3 可自由排；p4 是最远点，作为时间锚（locked + timeStart）放在下标 2
    const p1 = await mk(day1.id, { kind: 'point', pointId: 'p1' })
    const p2 = await mk(day1.id, { kind: 'point', pointId: 'p2' })
    const anchor = await mk(day1.id, { kind: 'point', pointId: 'p4', title: '锚点' })
    const p3 = await mk(day1.id, { kind: 'point', pointId: 'p3' })

    // createItemSchema 不接收 locked，必须走 PATCH 设置时间锚
    const patchAnchor = await itemHandlers.PATCH(
      req('/x', 'PATCH', { timeStart: '12:00', locked: true }),
      ctx({ id: detail.id, itemId: anchor })
    )
    expect(patchAnchor.status).toBe(200)

    const res = await optimizeHandlers.POST(req('/x', 'POST'), ctx({ id: detail.id, dayId: day1.id }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      before: string[]
      after: string[]
      distanceBeforeM: number
      distanceAfterM: number
      bookUpdatedAt: string
    }
    expect(body.before).toEqual([p1, p2, anchor, p3])
    // 时间锚保持原下标 2
    expect(body.after[2]).toBe(anchor)
    expect([body.after[0], body.after[1], body.after[3]].sort()).toEqual([p1, p2, p3].sort())
    expect(body.distanceAfterM).toBeLessThanOrEqual(body.distanceBeforeM)
    expect(typeof body.bookUpdatedAt).toBe('string')

    // 写回：仓储里的顺序与 after 一致
    const after = await deps.repo.getById(detail.id, 'u1')
    const dayOrder = after!.items.filter((item) => item.dayId === day1.id).sort((a, b) => a.sortOrder - b.sortOrder)
    expect(dayOrder.map((item) => item.id)).toEqual(body.after)
  })
})

describe('写接口契约（bookUpdatedAt / items）', () => {
  it('POST /items 响应带目标天完整条目与 bookUpdatedAt；连续两次 POST 不 409', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const day1 = detail.days[0]!
    const handlers = createItemHandlers(deps)

    const first = await handlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId: 'p1' }), ctx({ id: detail.id }))
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { item: { id: string }; items: { id: string; dayId: string | null; sortOrder: number }[]; bookUpdatedAt: string }
    expect(firstBody.items.filter((i) => i.dayId === day1.id).map((i) => i.id)).toEqual([firstBody.item.id])
    expect(firstBody.items.every((i) => i.dayId === null || i.dayId === day1.id)).toBe(true)
    expect(new Date(firstBody.bookUpdatedAt).getTime()).not.toBeNaN()

    // 第二次写入不带乐观锁也不冲突
    const second = await handlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId: 'p2' }), ctx({ id: detail.id }))
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as typeof firstBody
    expect(secondBody.items.filter((i) => i.dayId === day1.id).map((i) => i.id)).toHaveLength(2)
    expect(secondBody.items.filter((i) => i.dayId === day1.id).map((i) => i.sortOrder)).toEqual([0, 1])
  })

  it('DELETE item 后 PATCH title 不带 updatedAt 不 409', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const day1 = detail.days[0]!
    const itemHandlers = createItemHandlers(deps)
    const bookHandlers = createRouteBookHandlers(deps)

    const created = await itemHandlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId: 'p1' }), ctx({ id: detail.id }))
    const itemId = ((await created.json()) as { item: { id: string } }).item.id

    const removed = await itemHandlers.DELETE(req('/x', 'DELETE'), ctx({ id: detail.id, itemId }))
    expect(removed.status).toBe(200)
    expect(typeof ((await removed.json()) as { bookUpdatedAt: string }).bookUpdatedAt).toBe('string')

    const patched = await bookHandlers.PATCH(req('/x', 'PATCH', { title: '改名' }), ctx({ id: detail.id }))
    expect(patched.status).toBe(200)
    const patchedBody = (await patched.json()) as { routeBook: { title: string }; bookUpdatedAt: string }
    expect(patchedBody.routeBook.title).toBe('改名')
    expect(new Date(patchedBody.bookUpdatedAt).getTime()).not.toBeNaN()
  })

  it('reorder 响应带整本条目与 bookUpdatedAt，不接收 updatedAt 字段', async () => {
    const { deps } = makeDeps()
    const detail = await setupBook(deps)
    const day1 = detail.days[0]!
    const handlers = createItemHandlers(deps)

    const a = ((await (await handlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId: 'p1' }), ctx({ id: detail.id }))).json()) as { item: { id: string } }).item.id
    const b = ((await (await handlers.POST(req('/x', 'POST', { dayId: day1.id, kind: 'point', pointId: 'p2' }), ctx({ id: detail.id }))).json()) as { item: { id: string } }).item.id

    // 带上过期的 updatedAt 也不影响：schema 已不接收该字段，服务端不做 stale 判断
    const res = await handlers.REORDER(
      req('/x', 'POST', { dayId: day1.id, orderedItemIds: [b, a], updatedAt: new Date(0).toISOString() }),
      ctx({ id: detail.id })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { id: string; dayId: string | null }[]; bookUpdatedAt: string }
    expect(body.items.filter((i) => i.dayId === day1.id).map((i) => i.id)).toEqual([b, a])
    expect(new Date(body.bookUpdatedAt).getTime()).not.toBeNaN()
  })
})
