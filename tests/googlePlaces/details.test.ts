import { describe, expect, it, vi } from 'vitest'
import { createPlaceDetails } from '@/lib/googlePlaces/details'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response
}

describe('createPlaceDetails.getPlaceIntro', () => {
  it('正常映射：字段名转换、summary 取 editorial_summary.overview、openingHours 取 weekday_text、mapsUrl 取 url；URL 带指定 fields/language/key', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({
        status: 'OK',
        result: {
          name: '宇治食堂',
          formatted_address: '京都府宇治市宇治1-2-3',
          rating: 4.3,
          user_ratings_total: 1234,
          editorial_summary: { overview: '当地知名的抹茶餐厅。' },
          opening_hours: { weekday_text: ['星期一: 10:00 – 18:00', '星期二: 10:00 – 18:00'] },
          website: 'https://example.com',
          url: 'https://maps.google.com/?cid=123',
        },
      }),
    )
    const details = createPlaceDetails({ apiKey: 'key-1', fetchImpl })

    const intro = await details.getPlaceIntro('gp-abc', 'zh-CN')

    expect(intro).toEqual({
      name: '宇治食堂',
      address: '京都府宇治市宇治1-2-3',
      rating: 4.3,
      userRatingsTotal: 1234,
      summary: '当地知名的抹茶餐厅。',
      openingHours: ['星期一: 10:00 – 18:00', '星期二: 10:00 – 18:00'],
      website: 'https://example.com',
      mapsUrl: 'https://maps.google.com/?cid=123',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url.startsWith('https://maps.googleapis.com/maps/api/place/details/json?')).toBe(true)
    expect(url).toContain('place_id=gp-abc')
    expect(url).toContain('fields=name%2Cformatted_address%2Crating%2Cuser_ratings_total%2Ceditorial_summary%2Copening_hours%2Cwebsite%2Curl')
    expect(url).toContain('language=zh-CN')
    expect(url).toContain('key=key-1')
    // 不请求 photos
    expect(url).not.toContain('photos')
  })

  it('ZERO_RESULTS → null', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ZERO_RESULTS' }))
    const details = createPlaceDetails({ apiKey: 'key-1', fetchImpl })
    expect(await details.getPlaceIntro('gp-x', 'en')).toBeNull()
  })

  it('非 OK 状态 / HTTP 错误 / 网络异常 → null', async () => {
    const denied = createPlaceDetails({ apiKey: 'k', fetchImpl: vi.fn(async () => jsonResponse({ status: 'REQUEST_DENIED' })) })
    expect(await denied.getPlaceIntro('gp-x', 'en')).toBeNull()

    const http = createPlaceDetails({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response),
    })
    expect(await http.getPlaceIntro('gp-x', 'en')).toBeNull()

    const network = createPlaceDetails({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => {
        throw new Error('timeout')
      }),
    })
    expect(await network.getPlaceIntro('gp-x', 'en')).toBeNull()

    const noKeyFetch = vi.fn()
    const noKey = createPlaceDetails({ apiKey: '', fetchImpl: noKeyFetch })
    expect(await noKey.getPlaceIntro('gp-x', 'en')).toBeNull()
    expect(noKeyFetch).not.toHaveBeenCalled()
  })

  it('缺字段 → null/空数组兜底，name 缺失回退 placeId', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'OK', result: {} }))
    const details = createPlaceDetails({ apiKey: 'k', fetchImpl })
    expect(await details.getPlaceIntro('gp-min', 'ja')).toEqual({
      name: 'gp-min',
      address: null,
      rating: null,
      userRatingsTotal: null,
      summary: null,
      openingHours: [],
      website: null,
      mapsUrl: null,
    })
  })
})
