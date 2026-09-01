import { describe, it, expect, vi } from 'vitest'
import { createPlaceResolver, validateExternalPlacePayload } from '@/lib/googlePlaces/places'

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
    // 图片：opaque photo reference + 站内 keyless 代理 URL + 纯文本署名
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

  it('同 key 超出限速窗口 → rate_limited（8 次/分钟）', async () => {
    const fetchImpl = vi.fn(async () => googlePlaceBody())
    const resolver = createPlaceResolver({ apiKey: 'k', fetchImpl, rateKey: 'plan-rl' })
    for (let i = 0; i < 8; i++) {
      // 不同查询绕过缓存，逐次真实外呼
      const result = await resolver.resolveByText(`地点 ${i}`)
      expect(result.ok).toBe(true)
    }
    const ninth = await resolver.resolveByText('第九个地点')
    expect(ninth).toMatchObject({ ok: false, code: 'rate_limited' })
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
