import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMapTilerAddresses, parseGeocodeAddresses } from '@/lib/share/geocode'

/** 手工构造的 MapTiler 反查响应（language=zh,en,ja&limit=1），不发真实请求 */
const MUSASHINO = {
  type: 'FeatureCollection',
  features: [
    {
      id: 'address.1',
      place_name_zh: '中町一丁目, 武藏野市, 东京都/東京都, 日本',
      context: [
        { id: 'neighbourhood.11', text_zh: '中町一丁目', text_en: 'Nakacho 1-chome', text_ja: '中町一丁目' },
        { id: 'postal_code.12', text: '180-0006' },
        { id: 'municipality.13', text_zh: '武藏野市', text_en: 'Musashino', text_ja: '武蔵野市' },
        { id: 'region.14', text_zh: '东京都/東京都', text_en: 'Tokyo', text_ja: '東京都' },
        { id: 'country.15', text_zh: '日本', text_en: 'Japan', text_ja: '日本' },
      ],
    },
  ],
}

describe('parseGeocodeAddresses', () => {
  it('zh/ja 由粗到细用空格拼，en 由细到粗用逗号拼', () => {
    expect(parseGeocodeAddresses(MUSASHINO)).toEqual({
      zh: '东京都 武藏野市 中町一丁目',
      ja: '東京都 武蔵野市 中町一丁目',
      en: 'Nakacho 1-chome, Musashino, Tokyo',
    })
  })

  it('zh 的「东京都/東京都」并列取 / 前一段', () => {
    expect(parseGeocodeAddresses(MUSASHINO).zh?.startsWith('东京都 ')).toBe(true)
  })

  it('跳过邮编与国家', () => {
    const all = Object.values(parseGeocodeAddresses(MUSASHINO)).join('|')
    expect(all).not.toContain('180-0006')
    expect(all).not.toContain('日本')
    expect(all).not.toContain('Japan')
  })

  it('缺町丁目一级时只拼剩下的两级', () => {
    const payload = {
      features: [
        {
          context: [
            { id: 'place.1', text_zh: '富士河口湖町', text_en: 'Fujikawaguchiko', text_ja: '富士河口湖町' },
            { id: 'region.2', text_zh: '山梨县', text_en: 'Yamanashi', text_ja: '山梨県' },
          ],
        },
      ],
    }
    expect(parseGeocodeAddresses(payload)).toEqual({
      zh: '山梨县 富士河口湖町',
      ja: '山梨県 富士河口湖町',
      en: 'Fujikawaguchiko, Yamanashi',
    })
  })

  it('某一级缺该语言字段时退回无后缀的 text', () => {
    const payload = {
      features: [{ context: [{ id: 'region.1', text: '沖縄県' }] }],
    }
    expect(parseGeocodeAddresses(payload)).toEqual({ zh: '沖縄県', en: '沖縄県', ja: '沖縄県' })
  })

  it('同一层级出现多条时取第一条', () => {
    const payload = {
      features: [
        {
          context: [
            { id: 'municipality.1', text_zh: '甲' },
            { id: 'place.2', text_zh: '乙' },
          ],
        },
      ],
    }
    expect(parseGeocodeAddresses(payload).zh).toBe('甲')
  })

  it('空响应 / 无 context / 非对象都返回三个 null', () => {
    const empty = { zh: null, en: null, ja: null }
    expect(parseGeocodeAddresses({ features: [] })).toEqual(empty)
    expect(parseGeocodeAddresses({ features: [{}] })).toEqual(empty)
    expect(parseGeocodeAddresses(null)).toEqual(empty)
    expect(parseGeocodeAddresses('nope')).toEqual(empty)
  })
})

describe('fetchMapTilerAddresses', () => {
  const ORIGINAL_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.NEXT_PUBLIC_MAPTILER_KEY
    else process.env.NEXT_PUBLIC_MAPTILER_KEY = ORIGINAL_KEY
    vi.restoreAllMocks()
  })

  it('一次请求带 lng,lat 与 language=zh,en,ja&limit=1', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(MUSASHINO), { status: 200 }))
    const result = await fetchMapTilerAddresses({ lat: 35.7, lng: 139.56, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result?.ja).toBe('東京都 武蔵野市 中町一丁目')
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toBe(
      'https://api.maptiler.com/geocoding/139.56,35.7.json?key=mt-key&language=zh%2Cen%2Cja&limit=1',
    )
  })

  it('没有 key 时不发请求，直接返回 null', async () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = ''
    const fetchImpl = vi.fn()
    await expect(
      fetchMapTilerAddresses({ lat: 1, lng: 2, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('非 2xx 返回 null', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }))
    await expect(
      fetchMapTilerAddresses({ lat: 1, lng: 2, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull()
  })

  it('上游抛错（超时）返回 null 而不是往外扔', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout')
    })
    await expect(
      fetchMapTilerAddresses({ lat: 1, lng: 2, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull()
  })

  it('响应不是 JSON 时返回 null', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(
      fetchMapTilerAddresses({ lat: 1, lng: 2, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull()
  })
})
