import { describe, it, expect, vi } from 'vitest'
import {
  buildPlacePhotoDisplayUrl,
  createPlaceResolver,
  isSafePlacePhotoDisplayUrl,
  isValidPhotoReference,
  normalizePlaceQuery,
  validateExternalPlacePayload,
} from '@/lib/googlePlaces/places'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'

describe('isValidPhotoReference（R2：长引用上限 4096）', () => {
  it('700 字符合法引用通过（Google Nearby 实测 644–671 字符，旧上限 512 全丢）', () => {
    const longRef = `A${'b'.repeat(699)}`
    expect(longRef).toHaveLength(700)
    expect(isValidPhotoReference(longRef)).toBe(true)
  })

  it('超 4096 或字符集外仍拒绝；8 字符下限保持', () => {
    expect(isValidPhotoReference(`A${'b'.repeat(4096)}`)).toBe(false)
    expect(isValidPhotoReference(`A${'b'.repeat(4095)}`)).toBe(true)
    expect(isValidPhotoReference('Abcdefg!')).toBe(false)
    expect(isValidPhotoReference('Abcdefg')).toBe(false)
  })
})

describe('normalizePlaceQuery（查询词归一化）', () => {
  it('NFKC + 小写 + 去末尾括注 + 折叠空白', () => {
    expect(normalizePlaceQuery('  新千歳空港（抵达） ')).toBe('新千歳空港')
    expect(normalizePlaceQuery('Tokyo   Disneyland (Land)')).toBe('tokyo disneyland')
    expect(normalizePlaceQuery('ＡＢＣ')).toBe('abc')
    expect(normalizePlaceQuery('')).toBe('')
  })
})

describe('placeId display url（按 placeId 寻址的 keyless 代理 URL）', () => {
  it('按 placeId 生成 keyless 代理 URL 且被判定安全', () => {
    const url = buildPlacePhotoDisplayUrl({ placeId: 'ChIJ3RpcnUUgdV8R9oH25Xxguho' })
    expect(url).toBe('/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&maxwidth=1600')
    expect(url).not.toContain('key=')
    expect(isSafePlacePhotoDisplayUrl(url)).toBe(true)
    // 存量 ref 形式必须继续可用
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?ref=AVoNoXQO7E_XY74W4vkAxpdMeN41NvFl')).toBe(true)
    expect(buildPlacePhotoDisplayUrl({ photoReference: 'Aref_1234567890' }, 800)).toBe(
      '/api/google/place-photo?ref=Aref_1234567890&maxwidth=800',
    )
    // placeId 太短/非法字符 → 不安全；密钥类参数一律拒绝
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?placeId=x')).toBe(false)
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&key=abc')).toBe(false)
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&token=abc')).toBe(false)
    // 两者都缺 → 不安全
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?maxwidth=1600')).toBe(false)
  })

  it('A2：index > 0 时追加 &i=<n>，index 0/缺省不追加（现有 URL 不变）', () => {
    expect(buildPlacePhotoDisplayUrl({ placeId: 'ChIJ3RpcnUUgdV8R9oH25Xxguho', index: 2 })).toBe(
      '/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&maxwidth=1600&i=2',
    )
    expect(buildPlacePhotoDisplayUrl({ placeId: 'ChIJ3RpcnUUgdV8R9oH25Xxguho', index: 0 })).toBe(
      '/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&maxwidth=1600',
    )
    expect(buildPlacePhotoDisplayUrl({ placeId: 'ChIJ3RpcnUUgdV8R9oH25Xxguho', index: 1 }, 400)).toBe(
      '/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&maxwidth=400&i=1',
    )
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&maxwidth=1600&i=3')).toBe(true)
  })
})

function googlePlaceBody(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      status: 'OK',
      results: [
        {
          place_id: 'ChIJxxx_disney',
          name: '東京ディズニーランド',
          formatted_address: '日本千葉県浦安市舞浜 1-1',
          geometry: { location: { lat: 35.6329, lng: 139.8804 } },
          photos: [
            {
              photo_reference: 'Aphoto_REFERENCE_token-1234567890',
              html_attributions: ['<a href="https://maps.google.com/maps/contrib/1">Photo by Someone</a>'],
            },
          ],
          ...overrides,
        },
      ],
    }),
  } as unknown as Response
}

describe('createPlaceResolver', () => {
  it('文本搜索自动取第一个结果并保留全部持久化字段', async () => {
    const fetchImpl = vi.fn(async () => googlePlaceBody())
    const resolver = createPlaceResolver({ apiKey: 'test-key', fetchImpl, rateKey: 'plan-1' })

    const result = await resolver.resolveByText('东京迪士尼')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.place).toMatchObject({
      provider: 'google',
      placeId: 'ChIJxxx_disney',
      name: '東京ディズニーランド',
      address: '日本千葉県浦安市舞浜 1-1',
      lat: 35.6329,
      lng: 139.8804,
      mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJxxx_disney',
    })
    expect(result.place.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // 图片：opaque photo reference + 站内 keyless 代理 URL（无 store 时用 ref 寻址，
    // 不依赖地点库；有 store 落库成功才升级 placeId 寻址）+ 纯文本署名
    expect(result.place.photo?.photoReference).toBe('Aphoto_REFERENCE_token-1234567890')
    expect(result.place.photo?.displayUrl).toBe(
      '/api/google/place-photo?ref=Aphoto_REFERENCE_token-1234567890&maxwidth=1600',
    )
    expect(result.place.photo?.displayUrl).not.toContain('key=')
    expect(result.place.photo?.attribution).toBe('Photo by Someone')

    // 请求 URL 只在服务端拼接 key；返回值里不出现
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0])
    expect(calledUrl).toContain('key=test-key')
    expect(JSON.stringify(result)).not.toContain('test-key')
  })

  it('同查询命中缓存：第二次不重复外呼（有界缓存去重 Places 调用）', async () => {
    const fetchImpl = vi.fn(async () => googlePlaceBody())
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'plan-cache' })

    await resolver.resolveByText('东京迪士尼')
    await resolver.resolveByText('东京迪士尼')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('ZERO_RESULTS → typed not_found 错误，绝不编造地点', async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: true, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) }) as unknown as Response,
    )
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'plan-nf' })
    const result = await resolver.resolveByText('不存在的地点xyz')
    expect(result).toMatchObject({ ok: false, code: 'not_found' })
    expect(!result.ok && result.message).toContain('不存在的地点xyz')
  })

  it('REQUEST_DENIED → 显式配置错误（key 未启用 Places API）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({ ok: true, json: async () => ({ status: 'REQUEST_DENIED', error_message: 'not enabled' }) }) as unknown as Response,
    )
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'plan-denied' })
    const result = await resolver.resolveByText('东京迪士尼')
    expect(result).toMatchObject({ ok: false, code: 'config_error' })
    expect(!result.ok && result.message).toContain('REQUEST_DENIED')
  })

  it('缺 API key → config_error；空查询 → invalid_query', async () => {
    const resolver = createPlaceResolver({ apiKey: '', fetchImpl: vi.fn(), rateKey: 'plan-nocfg' })
    expect(await resolver.resolveByText('x')).toMatchObject({ ok: false, code: 'config_error' })

    const withKey = createPlaceResolver({ apiKey: 'k', fetchImpl: vi.fn(), rateKey: 'plan-empty' })
    expect(await withKey.resolveByText('   ')).toMatchObject({ ok: false, code: 'invalid_query' })
  })

  it('同 key 超出限速窗口 → rate_limited（R3 上调后 60 次/分钟）', async () => {
    const fetchImpl = vi.fn(async () => googlePlaceBody())
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'plan-rl' })
    for (let i = 0; i < 60; i++) {
      // 不同查询绕过缓存，逐次真实外呼
      const result = await resolver.resolveByText(`地点 ${i}`)
      expect(result.ok).toBe(true)
    }
    const sixtyFirst = await resolver.resolveByText('第六十一个地点')
    expect(sixtyFirst).toMatchObject({ ok: false, code: 'rate_limited' })
  })
})

describe('createPlaceResolver（地点库阶梯 + 位置偏置 + fromCache + onResolved）', () => {
  const newChitose = {
    provider: 'google' as const,
    placeId: 'ChIJ_newchitose',
    name: '新千歳空港',
    address: '北海道千歳市美里',
    lat: 42.7889,
    lng: 141.6947,
    mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_newchitose',
    photo: {
      photoReference: 'Aref_1234567890',
      displayUrl: '/api/google/place-photo?placeId=ChIJ_newchitose&maxwidth=1600',
      attribution: null,
    },
    fetchedAt: new Date().toISOString(),
  }

  it('库命中时不打 Google 且 fromCache=true（归一化查询词命中）', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(newChitose, normalizePlaceQuery('新千歳空港'))
    const fetchImpl = vi.fn()
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, store, rateKey: 'plan-store-hit' })
    const res = await resolver.resolveByText('新千歳空港（抵达）')
    expect(res).toMatchObject({ ok: true, fromCache: true })
    expect(res.ok && res.place.placeId).toBe('ChIJ_newchitose')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('N3 onGoogleCall：真实外呼前回调（Google 返回错误同样计数）；缓存/库命中与限速拒绝不回调', async () => {
    // Google 返回错误（OVER_QUERY_LIMIT）：请求真实发生 → 已计数
    const failingFetch = vi.fn(
      async () => ({ ok: true, json: async () => ({ status: 'OVER_QUERY_LIMIT', results: [] }) }) as unknown as Response,
    )
    let used = 0
    const failing = createPlaceResolver({ apiKey: 'k', fetchImpl: failingFetch, rateKey: 'plan-n3-err' })
    const failingResult = await failing.resolveByText('某地点', { onGoogleCall: () => (used += 1) })
    expect(failingResult).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(used).toBe(1)

    // 库命中：不打 Google → 不计数
    const store = createMemoryExternalPlaceStore()
    await store.upsert(newChitose, normalizePlaceQuery('新千歳空港'))
    const storeHit = createPlaceResolver({ apiKey: 'k', fetchImpl: vi.fn(), store, rateKey: 'plan-n3-store' })
    used = 0
    await storeHit.resolveByText('新千歳空港', { onGoogleCall: () => (used += 1) })
    expect(used).toBe(0)

    // 内存缓存命中（同 resolver 第二次同查询）：不计数
    const cacheResolver = createPlaceResolver({ apiKey: 'k', fetchImpl: async () => googlePlaceBody(), rateKey: 'plan-n3-cache' })
    await cacheResolver.resolveByText('东京迪士尼')
    used = 0
    await cacheResolver.resolveByText('东京迪士尼', { onGoogleCall: () => (used += 1) })
    expect(used).toBe(0)

    // 限速拒绝：请求未发生 → 不计数（R3 默认窗口 60 次/分钟）
    const rateLimited = createPlaceResolver({ apiKey: 'k', fetchImpl: async () => googlePlaceBody(), rateKey: 'plan-n3-rl' })
    for (let i = 0; i < 60; i++) await rateLimited.resolveByText(`地点 ${i}`)
    used = 0
    await rateLimited.resolveByText('第六十一个地点', { onGoogleCall: () => (used += 1) })
    expect(used).toBe(0)
  })

  it('未命中时打 Google、带 location/radius 偏置、upsert 入库并触发 onResolved', async () => {
    const onResolved = vi.fn()
    const store = createMemoryExternalPlaceStore()
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => googlePlaceBody())
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, store, onResolved, rateKey: 'plan-store-miss' })
    const res = await resolver.resolveByText('新千歳空港', { near: { lat: 42.78, lng: 141.69 } })
    const url = new URL(String(fetchImpl.mock.calls[0]![0]))
    expect(url.searchParams.get('location')).toBe('42.78,141.69')
    expect(url.searchParams.get('radius')).toBe('30000')
    expect(res).toMatchObject({ ok: true, fromCache: false })
    expect(await store.findByPlaceId('google', 'ChIJxxx_disney')).not.toBeNull()
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'ChIJxxx_disney' }))
    // lookup 变异步后仍按 placeId 命中（内存 → 库）
    expect(await resolver.lookup('ChIJxxx_disney')).not.toBeNull()
    expect(await resolver.lookup('unknown_place')).toBeNull()
  })

  it('radiusM 可覆盖默认偏置半径', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => googlePlaceBody())
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'plan-radius' })
    await resolver.resolveByText('某地点', { near: { lat: 1.5, lng: 2.5 }, radiusM: 5000 })
    const url = new URL(String(fetchImpl.mock.calls[0]![0]))
    expect(url.searchParams.get('radius')).toBe('5000')
  })

  it('photo.displayUrl 只在真正落库成功时用 placeId 寻址；无 store / upsert 抛错回退 ref 寻址', async () => {
    // 无 store → ?ref=（落库 URL 不依赖地点库可用性）
    const noStore = createPlaceResolver({ apiKey: 'k', fetchImpl: vi.fn(async () => googlePlaceBody()), rateKey: 'plan-url-1' })
    const res1 = await noStore.resolveByText('东京迪士尼')
    expect(res1.ok && res1.place.photo?.displayUrl).toBe(
      '/api/google/place-photo?ref=Aphoto_REFERENCE_token-1234567890&maxwidth=1600',
    )

    // store.upsert 抛错（库不可用/迁移未跑）→ 回退 ?ref=，绝不产出会永久 404 的 placeId URL
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken: ExternalPlaceStore = {
      findByQuery: async () => null,
      findByPlaceId: async () => null,
      upsert: async () => {
        throw new Error('db down')
      },
      setPhotoMirror: async () => undefined,
      updatePhotoReference: async () => undefined,
      updatePhotos: async () => undefined,
    }
    const failing = createPlaceResolver({ apiKey: 'k', fetchImpl: vi.fn(async () => googlePlaceBody()), store: broken, rateKey: 'plan-url-2' })
    const res2 = await failing.resolveByText('东京迪士尼')
    expect(res2.ok && res2.place.photo?.displayUrl).toBe(
      '/api/google/place-photo?ref=Aphoto_REFERENCE_token-1234567890&maxwidth=1600',
    )
    warn.mockRestore()

    // store 正常落库 → ?placeId=
    const healthy = createPlaceResolver({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => googlePlaceBody()),
      store: createMemoryExternalPlaceStore(),
      rateKey: 'plan-url-3',
    })
    const res3 = await healthy.resolveByText('东京迪士尼')
    expect(res3.ok && res3.place.photo?.displayUrl).toBe(
      '/api/google/place-photo?placeId=ChIJxxx_disney&maxwidth=1600',
    )
  })

  it('R4：persistQuery=false（点位解析器）→ 不查 findByQuery、upsert 第二参数为 null；placeId 仍可命中', async () => {
    const store = createMemoryExternalPlaceStore()
    const findByQuery = vi.fn(async (...args: Parameters<typeof store.findByQuery>) => store.findByQuery(...args))
    const upsert = vi.fn(async (...args: Parameters<typeof store.upsert>) => {
      await store.upsert(...args)
    })
    const wrapped: ExternalPlaceStore = { ...store, findByQuery, upsert }
    const fetchImpl = vi.fn(async () => googlePlaceBody())
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, store: wrapped, rateKey: 'plan-point-persist', persistQuery: false })
    const res = await resolver.resolveByText('踏切')
    expect(res).toMatchObject({ ok: true, fromCache: false })
    expect(findByQuery).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0]![1]).toBeNull()
    // 查询词行未写入：即便换了 resolver 也不会命中「踏切」（不污染计划 agent 的 findByQuery）
    const later = createPlaceResolver({ apiKey: 'k', fetchImpl: vi.fn(async () => googlePlaceBody()), store: wrapped, rateKey: 'plan-point-later' })
    const laterRes = await later.resolveByText('踏切')
    expect(laterRes).toMatchObject({ ok: true, fromCache: false })
    // 只查内存与 placeId：lookup 正常命中
    expect(await resolver.lookup('ChIJxxx_disney')).not.toBeNull()
  })

  it('库抛错时降级为无库模式（仍能解析，console.warn 提示）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store: ExternalPlaceStore = {
      findByQuery: async () => {
        throw new Error('db down')
      },
      findByPlaceId: async () => {
        throw new Error('db down')
      },
      upsert: async () => {
        throw new Error('db down')
      },
      setPhotoMirror: async () => {
        throw new Error('db down')
      },
      updatePhotoReference: async () => {
        throw new Error('db down')
      },
      updatePhotos: async () => {
        throw new Error('db down')
      },
    }
    const fetchImpl = vi.fn(async () => googlePlaceBody())
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, store, rateKey: 'plan-store-broken' })
    const res = await resolver.resolveByText('新千歳空港')
    expect(res).toMatchObject({ ok: true, fromCache: false })
    expect(warn).toHaveBeenCalledWith('[googlePlaces] store unavailable', expect.any(Error))
    warn.mockRestore()
  })
})

describe('validateExternalPlacePayload（save_plan_days 外部点位校验）', () => {
  const valid = { provider: 'google', placeId: 'ChIJ1', name: '东京站', lat: 35.6812, lng: 139.7671 }

  it('合法载荷通过', () => {
    expect(validateExternalPlacePayload(valid)).toBeNull()
  })

  it('缺 placeId/name/坐标 → 中文错误', () => {
    expect(validateExternalPlacePayload(null)).toContain('payload.place')
    expect(validateExternalPlacePayload({ ...valid, placeId: '' })).toContain('placeId')
    expect(validateExternalPlacePayload({ ...valid, name: 123 })).toContain('name')
    expect(validateExternalPlacePayload({ ...valid, lat: 'x' })).toContain('lat/lng')
    expect(validateExternalPlacePayload({ ...valid, lat: 999 })).toContain('范围')
  })
})
