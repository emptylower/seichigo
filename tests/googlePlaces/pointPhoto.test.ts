import { describe, it, expect, vi, type Mock } from 'vitest'
import type { Session } from 'next-auth'
import { createPointPhotoHandlers, type PointPhotoHandlerDeps } from '@/lib/googlePlaces/handlers/pointPhoto'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'
import { createMemoryPointPlaceLinkStore } from '@/lib/googlePlaces/pointPlaceLink'
import type { PointPlaceLinkRow } from '@/lib/googlePlaces/pointPlaceLink'
import type { PlaceResolver, ResolvedPlace } from '@/lib/googlePlaces/places'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'

/**
 * 回归第四轮 A5：点位兜底图接口。已有链接直接取图不调 Text Search；无链接
 * 解析一次 → setLink resolved → 回图；结果距离 > 1km → not_found 落库 404；
 * 7 天内再次请求不再解析；未登录 401。
 */

const pointRow = (over: Partial<PointPlaceLinkRow> = {}): PointPlaceLinkRow => ({
  id: '115908:point-1',
  name: '四谷駅',
  nameZh: '四谷站',
  lat: 35.6856,
  lng: 139.7273,
  googlePlaceId: null,
  googlePlaceStatus: null,
  googlePlaceResolvedAt: null,
  ...over,
})

const place: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_yotsuya',
  name: '四谷駅',
  address: null,
  lat: 35.6856,
  lng: 139.7273,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_yotsuya',
  photo: {
    photoReference: 'Aref_yotsuya_1234567890',
    displayUrl: '/api/google/place-photo?placeId=ChIJ_yotsuya&maxwidth=1600',
    attribution: null,
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

function imageResponse(bytes = new Uint8Array([1, 2, 3]).buffer): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes,
  } as unknown as Response
}

/** 解析器 mock：记录调用参数；placeId/lat/lng 可注入（距离守卫用例） */
function makeResolver(result: { ok: true; place: ResolvedPlace } | { ok: false; code: 'rate_limited' | 'not_found' }) {
  const resolveByText = vi.fn(async (_query: string, _opts?: { near?: { lat: number; lng: number }; radiusM?: number }) =>
    result.ok ? { ok: true as const, place: result.place, fromCache: false } : { ok: false as const, code: result.code, message: '失败' },
  )
  const resolver: PlaceResolver = { resolveByText, lookup: vi.fn(async () => null), remember: vi.fn() }
  return { resolver, resolveByText }
}

function makeDeps(over: Partial<PointPhotoHandlerDeps> = {}): PointPhotoHandlerDeps {
  const store: ExternalPlaceStore = createMemoryExternalPlaceStore()
  return {
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } } as Session),
    apiKey: 'SECRET_KEY',
    store,
    pointLinks: createMemoryPointPlaceLinkStore(),
    resolver: makeResolver({ ok: true, place }).resolver,
    fetchImpl: vi.fn(async () => imageResponse()),
    ...over,
  }
}

function makeRequest(pointId?: string): Request {
  const url = new URL('http://localhost/api/google/point-photo')
  if (pointId) url.searchParams.set('pointId', pointId)
  return new Request(url.toString())
}

function seedLinks(deps: PointPhotoHandlerDeps, rows: PointPlaceLinkRow[]): ReturnType<typeof createMemoryPointPlaceLinkStore> {
  const seeded = createMemoryPointPlaceLinkStore(rows)
  deps.pointLinks = seeded
  return seeded
}

describe('point photo handler（点位兜底图）', () => {
  it('未登录 401；pointId 缺失/超长 400；点位不存在 404', async () => {
    const anonymous = makeDeps({ getSession: vi.fn().mockResolvedValue(null) })
    expect((await createPointPhotoHandlers(anonymous).GET(makeRequest('115908:point-1'))).status).toBe(401)

    const handlers = createPointPhotoHandlers(makeDeps())
    expect((await handlers.GET(makeRequest())).status).toBe(400)
    expect((await handlers.GET(makeRequest('x'.repeat(201)))).status).toBe(400)
    expect((await handlers.GET(makeRequest('115908:unknown'))).status).toBe(404)
  })

  it('无链接 → Text Search 一次（带 near=点位坐标、radius 300m）→ setLink resolved → 回图', async () => {
    const { resolver, resolveByText } = makeResolver({ ok: true, place })
    const deps = makeDeps({ resolver })
    void deps.store?.upsert(place, null)
    const links = seedLinks(deps, [pointRow()])
    const res = await createPointPhotoHandlers(deps).GET(makeRequest('115908:point-1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(res.headers.get('Cache-Control')).toContain('max-age=86400')
    expect(resolveByText).toHaveBeenCalledTimes(1)
    expect(resolveByText).toHaveBeenCalledWith(
      '四谷站',
      expect.objectContaining({ near: { lat: 35.6856, lng: 139.7273 }, radiusM: 300 }),
    )
    expect(links.calls).toHaveLength(1)
    expect(links.calls[0]).toMatchObject({ pointId: '115908:point-1', placeId: 'ChIJ_yotsuya', status: 'resolved' })
    // place-photo 上游被调 1 次（地点库里的引用），fetch 的 URL 不含密钥之外的问题——key 只在服务端
    const upstream = (deps.fetchImpl as Mock).mock.calls.map((c) => String(c[0])).filter((u) => u.includes('photoreference='))
    expect(upstream).toHaveLength(1)
    expect(upstream[0]).toContain('photoreference=Aref_yotsuya_1234567890')
  })

  it('已有链接直接取图，不调 Text Search', async () => {
    const { resolver, resolveByText } = makeResolver({ ok: true, place })
    const deps = makeDeps({ resolver })
    void deps.store?.upsert(place, null)
    seedLinks(deps, [pointRow({ googlePlaceId: 'ChIJ_yotsuya', googlePlaceStatus: 'resolved', googlePlaceResolvedAt: new Date() })])
    const res = await createPointPhotoHandlers(deps).GET(makeRequest('115908:point-1'))
    expect(res.status).toBe(200)
    expect(resolveByText).not.toHaveBeenCalled()
    const upstream = (deps.fetchImpl as Mock).mock.calls.map((c) => String(c[0])).filter((u) => u.includes('photoreference='))
    expect(upstream).toHaveLength(1)
  })

  it('R3：已有链接 → placeId 路径 404 → 只清内存副本（不落 not_found）→ Text Search 重新解析 → 新链接落库 → 回图', async () => {
    const newPlace: ResolvedPlace = { ...place, placeId: 'ChIJ_yotsuya_new', photo: { ...place.photo!, photoReference: 'Aref_yotsuya_new_01' } }
    const { resolver, resolveByText } = makeResolver({ ok: true, place: newPlace })
    const deps = makeDeps({ resolver })
    void deps.store?.upsert(newPlace, null)
    const links = seedLinks(deps, [pointRow({ googlePlaceId: 'ChIJ_yotsuya', googlePlaceStatus: 'resolved', googlePlaceResolvedAt: new Date() })])
    const res = await createPointPhotoHandlers(deps).GET(makeRequest('115908:point-1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    // 触发了重新解析；新链接落库为 resolved（没有任何 not_found 写入）
    expect(resolveByText).toHaveBeenCalledTimes(1)
    expect(links.calls).toEqual([
      { pointId: '115908:point-1', placeId: 'ChIJ_yotsuya_new', status: 'resolved', resolvedAt: expect.any(Date) },
    ])
    const upstream = (deps.fetchImpl as Mock).mock.calls.map((c) => String(c[0])).filter((u) => u.includes('photoreference='))
    expect(upstream).toHaveLength(1)
    expect(upstream[0]).toContain('photoreference=Aref_yotsuya_new_01')
  })

  it('解析结果距离约 5km → not_found 落库 404；7 天内再次请求不再调 Text Search', async () => {
    const farPlace: ResolvedPlace = { ...place, lat: 35.73, lng: 139.76 }
    const { resolver, resolveByText } = makeResolver({ ok: true, place: farPlace })
    const deps = makeDeps({ resolver })
    const links = seedLinks(deps, [pointRow()])
    const handlers = createPointPhotoHandlers(deps)
    const first = await handlers.GET(makeRequest('115908:point-1'))
    expect(first.status).toBe(404)
    expect(await first.json()).toMatchObject({ error: '该点位没有可用的 Google 图片' })
    expect(links.calls).toHaveLength(1)
    expect(links.calls[0]).toMatchObject({ placeId: null, status: 'not_found' })

    const second = await handlers.GET(makeRequest('115908:point-1'))
    expect(second.status).toBe(404)
    expect(resolveByText).toHaveBeenCalledTimes(1)
  })

  it('Text Search 限流/服务端错误 → 503 且不落库', async () => {
    const { resolver } = makeResolver({ ok: false, code: 'rate_limited' })
    const deps = makeDeps({ resolver })
    const links = seedLinks(deps, [pointRow()])
    const res = await createPointPhotoHandlers(deps).GET(makeRequest('115908:point-1'))
    expect(res.status).toBe(503)
    expect(links.calls).toHaveLength(0)
  })

  it('点位无坐标时不带 near，解析成功照常回图', async () => {
    const { resolver, resolveByText } = makeResolver({ ok: true, place })
    const deps = makeDeps({ resolver })
    void deps.store?.upsert(place, null)
    seedLinks(deps, [pointRow({ lat: null, lng: null })])
    const res = await createPointPhotoHandlers(deps).GET(makeRequest('115908:point-1'))
    expect(res.status).toBe(200)
    expect(resolveByText).toHaveBeenCalledTimes(1)
    expect(resolveByText).toHaveBeenCalledWith('四谷站', expect.not.objectContaining({ near: expect.anything() }))
  })

  it('R5：回图路径抛异常（如 waitUntil Illegal invocation）→ 502 { error: 图片读取失败 }，不吞成 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { resolver } = makeResolver({ ok: true, place })
      // bucket 存在才会走 finishWithUpstream → deps.waitUntil(write)；
      // 注入一个被调用即抛的 waitUntil，模拟脱离 ctx 的 Illegal invocation
      const bucket = {
        head: vi.fn(async () => null),
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
      }
      const deps = makeDeps({
        resolver,
        bucket,
        waitUntil: () => {
          throw new TypeError("Illegal invocation: function called with incorrect 'this' reference")
        },
      })
      void deps.store?.upsert(place, null)
      seedLinks(deps, [pointRow({ googlePlaceId: 'ChIJ_yotsuya', googlePlaceStatus: 'resolved', googlePlaceResolvedAt: new Date() })])
      const res = await createPointPhotoHandlers(deps).GET(makeRequest('115908:point-1'))
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: '图片读取失败' })
      // 日志带 pointId/placeId，方便线上定位
      expect(errorSpy).toHaveBeenCalledWith(
        '[googlePlaces/point-photo] serve photo failed',
        { pointId: '115908:point-1', placeId: 'ChIJ_yotsuya' },
        expect.any(TypeError),
      )
    } finally {
      errorSpy.mockRestore()
    }
  })
})
