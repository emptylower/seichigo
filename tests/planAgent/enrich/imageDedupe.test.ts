import { describe, it, expect, vi } from 'vitest'
import { imageKeyOf, runImageDedupeEnricher } from '@/lib/planAgent/enrich/imageDedupeEnricher'
import { runNeighborImageEnricher } from '@/lib/planAgent/enrich/neighborImageEnricher'
import { emptyEnrichReport, type EnrichContext, type EnrichDay } from '@/lib/planAgent/enrich/types'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'
import type { PlacePhotoRef, ResolvedPlace } from '@/lib/googlePlaces/places'

/**
 * 回归第四轮 A4：计划内图片去重。同一 Google 地点多条条目同图 → 按序号错开
 * （&i=<n>）；库里照片不足时经 fetchPlacePhotos 补拉一次并回写；neighbor
 * 兜底按展开序号借图、lunch/dinner meal 绝不借图。
 */

const photos: PlacePhotoRef[] = [
  { photoReference: 'Aref_shinjuku_01', attribution: 'P1' },
  { photoReference: 'Aref_shinjuku_02', attribution: 'P2' },
  { photoReference: 'Aref_shinjuku_03', attribution: null },
]

const shinjukuPlace: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_shinjuku',
  name: '新宿站',
  address: null,
  lat: 35.6896,
  lng: 139.7006,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_shinjuku',
  photo: {
    photoReference: photos[0].photoReference,
    displayUrl: '/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600',
    attribution: 'P1',
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

function mediaItem(title: string, overrides: Record<string, unknown> = {}): EnrichDay['items'][number] {
  return {
    type: 'free',
    title,
    payload: {
      place: { provider: 'google', placeId: 'ChIJ_shinjuku', name: '新宿站', lat: 35.6896, lng: 139.7006 },
      media: {
        source: 'google_places',
        displayUrl: '/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600',
        attribution: 'P1',
      },
      ...overrides,
    },
  }
}

function day(items: EnrichDay['items']): EnrichDay[] {
  return [{ dayIndex: 1, citySlug: null, summary: null, items }]
}

function ctxWithStore(store?: ExternalPlaceStore, over: Partial<EnrichContext> = {}): EnrichContext {
  return {
    ...(store ? { deps: { externalPlaces: store } } : { deps: {} }),
    coordsByPointId: new Map(),
    ...over,
  } as EnrichContext
}

describe('imageKeyOf（去重键口径）', () => {
  it('place-photo URL 折叠成 placeId+序号（忽略 maxwidth）；ref 形式单独键；其他 URL 去掉 query', () => {
    expect(imageKeyOf('/api/google/place-photo?placeId=ChIJ_x&maxwidth=1600')).toBe('google:ChIJ_x:0')
    expect(imageKeyOf('/api/google/place-photo?placeId=ChIJ_x&maxwidth=400&i=2')).toBe('google:ChIJ_x:2')
    expect(imageKeyOf('/api/google/place-photo?ref=Aref_1234567890&maxwidth=1600')).toBe('googleref:Aref_1234567890')
    expect(imageKeyOf('/img/anitabi/p1.jpg?v=2')).toBe('/img/anitabi/p1.jpg')
  })

  it('R9：非 Google URL 的键带 origin——两个不同 host 同路径不相等；站内相对路径（哨兵 origin）只用 pathname', () => {
    expect(imageKeyOf('https://a.example.com/img/x.jpg')).not.toBe(imageKeyOf('https://b.example.com/img/x.jpg'))
    expect(imageKeyOf('https://a.example.com/img/x.jpg?v=3')).toBe('https://a.example.com/img/x.jpg')
    expect(imageKeyOf('/img/anitabi/p1.jpg?v=2')).toBe('/img/anitabi/p1.jpg')
  })
})

describe('runImageDedupeEnricher（计划内图片去重）', () => {
  it('三条目同一 placeId、库里该地点有 3 张照片 → i 缺省/&i=1/&i=2，applied.dedupe === 2', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert({ ...shinjukuPlace, photos }, null)
    const days = day([mediaItem('机场前往新宿'), mediaItem('新宿街头散步'), mediaItem('住宿新宿')])
    const report = emptyEnrichReport()
    await runImageDedupeEnricher(days, ctxWithStore(store), report)
    expect(report.applied.dedupe).toBe(2)
    const urls = days[0].items.map((item) => (item.payload?.media as Record<string, unknown>).displayUrl)
    expect(urls[0]).toBe('/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600')
    expect(urls[1]).toBe('/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600&i=1')
    expect(urls[2]).toBe('/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600&i=2')
    const media2 = days[0].items[1].payload?.media as Record<string, unknown>
    expect(media2.photoIndex).toBe(1)
    expect(media2.attribution).toBe('P2')
    const media3 = days[0].items[2].payload?.media as Record<string, unknown>
    expect(media3.photoIndex).toBe(2)
    expect('attribution' in media3 && media3.attribution === 'P2').toBe(false)
  })

  it('库里只有 1 张、注入 fetchPlacePhotos 返回 3 张 → 调用 1 次、updatePhotos 回写、第 2 条 &i=1', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(shinjukuPlace, null)
    const updatePhotos = vi.fn(async (...args: Parameters<ExternalPlaceStore['updatePhotos']>) => {
      await store.updatePhotos(...args)
    })
    const fetchPlacePhotos = vi.fn(async (input: { onGoogleCall?: () => void }) => {
      input.onGoogleCall?.() // 模拟真实装配：发起请求前回调计数（N3 契约）
      return photos
    })
    const days = day([mediaItem('条目一'), mediaItem('条目二')])
    const ctx = ctxWithStore({ ...store, updatePhotos } as ExternalPlaceStore, {
      deps: { externalPlaces: { ...store, updatePhotos } as ExternalPlaceStore, fetchPlacePhotos },
      budget: { directions: { used: 0, max: 12 }, places: { used: 0, max: 6 }, windowStartedAt: Date.now() },
    })
    const report = emptyEnrichReport()
    await runImageDedupeEnricher(days, ctx, report)
    expect(fetchPlacePhotos).toHaveBeenCalledTimes(1)
    expect(updatePhotos).toHaveBeenCalledWith('google', 'ChIJ_shinjuku', photos)
    expect(report.applied.dedupe).toBe(1)
    expect((days[0].items[1].payload?.media as Record<string, unknown>).displayUrl).toContain('&i=1')
    // fetchPlacePhotos 的调用计入 places 预算
    expect(ctx.budget?.places.used).toBe(1)
  })

  it('预算已满 → 不调 fetchPlacePhotos，记 skipped（该地点只有一张照片）', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(shinjukuPlace, null)
    const fetchPlacePhotos = vi.fn(async (input: { onGoogleCall?: () => void }) => {
      input.onGoogleCall?.() // 模拟真实装配：发起请求前回调计数（N3 契约）
      return photos
    })
    const days = day([mediaItem('条目一'), mediaItem('条目二')])
    const ctx = ctxWithStore(store, {
      deps: { externalPlaces: store, fetchPlacePhotos },
      budget: { directions: { used: 0, max: 12 }, places: { used: 6, max: 6 }, windowStartedAt: Date.now() },
    })
    const report = emptyEnrichReport()
    await runImageDedupeEnricher(days, ctx, report)
    expect(fetchPlacePhotos).not.toHaveBeenCalled()
    expect(report.applied.dedupe).toBe(0)
    expect(report.skipped).toContainEqual(expect.objectContaining({ enricher: 'dedupe', reason: '该地点只有一张照片' }))
    // 保持重复（不改写）
    expect((days[0].items[1].payload?.media as Record<string, unknown>).displayUrl).not.toContain('&i=')
  })

  it('R5：3 条同地点、库里 1 张、fetchPlacePhotos 返回 null → 只补拉 1 次，预算只扣 1', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(shinjukuPlace, null)
    const fetchPlacePhotos = vi.fn(async (input: { onGoogleCall?: () => void }) => {
      input.onGoogleCall?.() // 模拟真实装配：发起请求前回调计数（N3 契约）
      return null
    })
    const days = day([mediaItem('条目一'), mediaItem('条目二'), mediaItem('条目三')])
    const ctx = ctxWithStore(store, {
      deps: { externalPlaces: store, fetchPlacePhotos },
      budget: { directions: { used: 0, max: 12 }, places: { used: 0, max: 6 }, windowStartedAt: Date.now() },
    })
    const report = emptyEnrichReport()
    await runImageDedupeEnricher(days, ctx, report)
    expect(fetchPlacePhotos).toHaveBeenCalledTimes(1)
    expect(ctx.budget?.places.used).toBe(1)
    expect(report.applied.dedupe).toBe(0) // 拉不到第二张：保持重复并记 skipped
    expect(report.skipped).toHaveLength(2)
  })

  it('幂等：连跑两次，第二次 applied.dedupe === 0', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert({ ...shinjukuPlace, photos }, null)
    const days = day([mediaItem('条目一'), mediaItem('条目二'), mediaItem('条目三')])
    const ctx = ctxWithStore(store)
    const first = emptyEnrichReport()
    await runImageDedupeEnricher(days, ctx, first)
    expect(first.applied.dedupe).toBe(2)
    const second = emptyEnrichReport()
    await runImageDedupeEnricher(days, ctx, second)
    expect(second.applied.dedupe).toBe(0)
    expect(second.skipped).toHaveLength(0)
  })
})

describe('runNeighborImageEnricher（A4 修订：展开序号借图 + 餐厅绝不借图）', () => {
  function ctxForNeighbor(store?: ExternalPlaceStore): EnrichContext {
    return {
      ...(store ? { deps: { externalPlaces: store } } : { deps: {} }),
      coordsByPointId: new Map(),
    } as EnrichContext
  }

  it('两条无图条目相邻一个多照片地点 → 分别借到不同序号的照片；lunch meal 无图不借', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert({ ...shinjukuPlace, photos }, null)
    const days = day([
      mediaItem('新宿站'),
      { type: 'free', title: '自由安排一' },
      { type: 'free', title: '自由安排二' },
      { type: 'meal', title: '午餐', payload: { mealSlot: 'lunch' } },
    ])
    const report = emptyEnrichReport()
    await runNeighborImageEnricher(days, ctxForNeighbor(store), report)
    expect(report.applied.neighbor).toBe(2)
    const free1 = days[0].items[1].payload?.media as Record<string, unknown>
    const free2 = days[0].items[2].payload?.media as Record<string, unknown>
    // 多照片地点自身占 i=0：两条无图条目分别借到 i=1 / i=2（不共用同一张）
    expect(free1.source).toBe('neighbor')
    expect(free1.displayUrl).toBe('/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600&i=1')
    expect(free2.displayUrl).toBe('/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600&i=2')
    // lunch meal 无图不借（餐厅必须有自己的照片）
    expect(days[0].items[3].payload?.media ?? null).toBeNull()
  })

  it('候选只有单张照片时退回原图（现行为保持）', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(shinjukuPlace, null)
    const days = day([
      mediaItem('新宿站'),
      { type: 'free', title: '自由安排' },
    ])
    const report = emptyEnrichReport()
    await runNeighborImageEnricher(days, ctxForNeighbor(store), report)
    expect(report.applied.neighbor).toBe(1)
    expect((days[0].items[1].payload?.media as Record<string, unknown>).displayUrl).toBe(
      '/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600',
    )
  })

  it('payload.place.photos 无多照片且无库时按单张展开（不额外查库）', async () => {
    const days = day([
      mediaItem('新宿站'),
      { type: 'free', title: '自由安排' },
    ])
    const report = emptyEnrichReport()
    await runNeighborImageEnricher(days, ctxForNeighbor(), report)
    expect(report.applied.neighbor).toBe(1)
    expect((days[0].items[1].payload?.media as Record<string, unknown>).displayUrl).toBe(
      '/api/google/place-photo?placeId=ChIJ_shinjuku&maxwidth=1600',
    )
  })

  it('R8：同一 placeId 只查一次库（备忘录）——3 个无图条目共用 2 个候选地点 → findByPlaceId ≤ 2 次', async () => {
    const store = createMemoryExternalPlaceStore()
    const photosA: PlacePhotoRef[] = [
      { photoReference: 'Aref_a_00000001', attribution: null },
      { photoReference: 'Aref_a_00000002', attribution: null },
      { photoReference: 'Aref_a_00000003', attribution: null },
    ]
    const photosB: PlacePhotoRef[] = [
      { photoReference: 'Aref_b_00000001', attribution: null },
      { photoReference: 'Aref_b_00000002', attribution: null },
      { photoReference: 'Aref_b_00000003', attribution: null },
    ]
    await store.upsert({ ...shinjukuPlace, placeId: 'ChIJ_cand_place_a', photos: photosA }, null)
    await store.upsert({ ...shinjukuPlace, placeId: 'ChIJ_cand_place_b', photos: photosB }, null)
    let findByPlaceIdCalls = 0
    const counting: ExternalPlaceStore = {
      ...store,
      findByPlaceId: async (provider, placeId) => {
        findByPlaceIdCalls += 1
        return store.findByPlaceId(provider, placeId)
      },
    }
    const googleItem = (title: string, placeId: string): EnrichDay['items'][number] => ({
      type: 'free',
      title,
      payload: {
        place: { provider: 'google', placeId, name: title, lat: 35.6896, lng: 139.7006 },
        media: { source: 'google_places', displayUrl: `/api/google/place-photo?placeId=${placeId}&maxwidth=1600` },
      },
    })
    const days = day([
      googleItem('地点甲', 'ChIJ_cand_place_a'),
      googleItem('地点乙', 'ChIJ_cand_place_b'),
      { type: 'free', title: '无图一' },
      { type: 'free', title: '无图二' },
      { type: 'free', title: '无图三' },
    ])
    const report = emptyEnrichReport()
    await runNeighborImageEnricher(days, ctxForNeighbor(counting), report)
    expect(report.applied.neighbor).toBe(3)
    expect(findByPlaceIdCalls).toBeLessThanOrEqual(2)
    expect(findByPlaceIdCalls).toBeGreaterThanOrEqual(1)
  })
})
