import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import { fetchGeocodeSearchResults, parseGeocodeSearchResults, sortGeocodeResultsByDistance } from '@/lib/share/geocodeSearch'
import { createGeocodeSearchHandlers } from '@/lib/share/handlers/geocodeSearch'

/** 手工构造的 MapTiler 正向搜索响应（language=zh），不发真实请求 */
const GHIBLI_SEARCH = {
  type: 'FeatureCollection',
  features: [
    {
      id: 'poi.1',
      text: '三鹰之森吉卜力美术馆',
      place_name: '三鹰之森吉卜力美术馆, 中町一丁目, 武藏野市, 东京都, 日本',
      center: [139.5784, 35.6967],
    },
    {
      id: 'poi.2',
      text: '吉卜力美术馆商店',
      place_name: '吉卜力美术馆商店',
      center: [139.5785, 35.6968],
    },
    {
      id: 'poi.3',
      text: '无坐标点',
      place_name: '无坐标点, 某处',
    },
    {
      id: 'poi.4',
      text: '井之头公园',
      place_name: '井之头公园, 御殿山, 吉祥寺, 武藏野市, 东京都, 日本',
      center: [139.5726, 35.7046],
    },
  ],
}

describe('parseGeocodeSearchResults', () => {
  it('解析 title / address / 坐标（lng,lat 换序），跳过无坐标条目', () => {
    const results = parseGeocodeSearchResults(GHIBLI_SEARCH, 'zh')
    expect(results).toEqual([
      { title: '三鹰之森吉卜力美术馆', address: '三鹰之森吉卜力美术馆, 中町一丁目, 武藏野市, 东京都, 日本', lat: 35.6967, lng: 139.5784 },
      { title: '吉卜力美术馆商店', address: null, lat: 35.6968, lng: 139.5785 },
      { title: '井之头公园', address: '井之头公园, 御殿山, 吉祥寺, 武藏野市, 东京都, 日本', lat: 35.7046, lng: 139.5726 },
    ])
  })

  it('place_name 与 title 相同时 address 为 null', () => {
    const [second] = parseGeocodeSearchResults(GHIBLI_SEARCH, 'zh').filter((r) => r.title === '吉卜力美术馆商店')
    expect(second?.address).toBeNull()
  })

  it('优先取 text_<lang>，缺该语言字段时退回 text', () => {
    const payload = {
      features: [
        {
          text: 'Default Name',
          text_zh: '中文名',
          place_name: 'Default Name, Somewhere',
          place_name_zh: '中文名, 某地',
          center: [139.5, 35.7],
        },
      ],
    }
    expect(parseGeocodeSearchResults(payload, 'zh')[0]).toMatchObject({ title: '中文名', address: '中文名, 某地' })
    expect(parseGeocodeSearchResults(payload, 'en')[0]).toMatchObject({ title: 'Default Name', address: 'Default Name, Somewhere' })
  })

  it('最多返回 limit 条（默认 5）', () => {
    const features = Array.from({ length: 7 }, (_, i) => ({ text: `点位${i}`, place_name: `点位${i}, 市`, center: [139.5, 35.7] }))
    expect(parseGeocodeSearchResults({ features }, 'zh')).toHaveLength(5)
    expect(parseGeocodeSearchResults({ features }, 'zh', 3)).toHaveLength(3)
  })

  it('无 text 时用 place_name 当 title；坐标非法（越界/非数字）跳过', () => {
    const payload = {
      features: [
        { place_name: '只有地名', center: [139.5, 35.7] },
        { text: '纬度越界', place_name: 'x', center: [139.5, 91] },
        { text: '经度越界', place_name: 'x', center: [181, 35.7] },
        { text: '非数字', place_name: 'x', center: ['a', 'b'] },
      ],
    }
    expect(parseGeocodeSearchResults(payload, 'zh')).toEqual([{ title: '只有地名', address: null, lat: 35.7, lng: 139.5 }])
  })

  it('countryCode 取 properties.country_code，其次 context 的 country 条目；都没有则不带', () => {
    const payload = {
      features: [
        { text: '京都駅', place_name: '京都駅, 京都市, 日本', center: [135.7588, 34.9858], properties: { country_code: 'JP' } },
        {
          text: '京都里',
          place_name: '京都里, 板橋郡, 江原道, 朝鲜',
          center: [127.000087, 38.767866],
          context: [{ id: 'region.1', text: '江原道' }, { id: 'country.2', text: '朝鲜', country_code: 'kp' }],
        },
        { text: '无国家', place_name: '无国家, 某处', center: [139.5, 35.7] },
      ],
    }
    const results = parseGeocodeSearchResults(payload, 'zh')
    expect(results.map((row) => row.countryCode)).toEqual(['jp', 'kp', undefined])
    expect('countryCode' in results[2]!).toBe(false)
  })

  it('空响应 / 非对象 / features 非数组都返回空数组', () => {
    expect(parseGeocodeSearchResults(null, 'zh')).toEqual([])
    expect(parseGeocodeSearchResults('nope', 'zh')).toEqual([])
    expect(parseGeocodeSearchResults({ features: 'x' }, 'zh')).toEqual([])
    expect(parseGeocodeSearchResults({ features: [] }, 'zh')).toEqual([])
  })
})

describe('fetchGeocodeSearchResults', () => {
  const ORIGINAL_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = 'mt-key'
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.NEXT_PUBLIC_MAPTILER_KEY
    else process.env.NEXT_PUBLIC_MAPTILER_KEY = ORIGINAL_KEY
    vi.restoreAllMocks()
  })

  it('请求 URL 带 encodeURIComponent(q)、language、limit=5 与 proximity=lng,lat', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(GHIBLI_SEARCH), { status: 200 }),
    )
    const results = await fetchGeocodeSearchResults({
      q: '吉卜力 美术馆',
      lang: 'ja',
      near: { lat: 35.7, lng: 139.56 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(results).toHaveLength(3)
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toBe(
      'https://api.maptiler.com/geocoding/%E5%90%89%E5%8D%9C%E5%8A%9B%20%E7%BE%8E%E6%9C%AF%E9%A6%86.json?key=mt-key&language=ja&limit=5&proximity=139.56%2C35.7',
    )
  })

  it('country 参数逗号拼接进 URL；有 near 时结果按距离升序（服务端排序）', async () => {
    const payload = {
      features: [
        { text: '京都里', place_name: '京都里, 板橋郡, 江原道, 朝鲜', center: [127.000087, 38.767866] },
        { text: '京都駅', place_name: '京都駅, 京都市, 日本', center: [135.7588, 34.9858] },
        { text: '東京駅', place_name: '東京駅, 千代田区, 日本', center: [139.7671, 35.6812] },
      ],
    }
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(payload), { status: 200 }))
    const results = await fetchGeocodeSearchResults({
      q: '京都駅',
      lang: 'zh',
      near: { lat: 34.88, lng: 135.8 },
      country: ['jp', 'kr'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toContain('&country=jp%2Ckr')
    expect(results.map((row) => row.title)).toEqual(['京都駅', '東京駅', '京都里'])
  })

  it('没有 near 时不带 proximity 参数', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ features: [] }), { status: 200 }),
    )
    await fetchGeocodeSearchResults({ q: 'tokyo', lang: 'en', fetchImpl: fetchImpl as unknown as typeof fetch })
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toBe('https://api.maptiler.com/geocoding/tokyo.json?key=mt-key&language=en&limit=5')
  })

  it('没有 key 时不发请求，直接返回空数组', async () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = ''
    const fetchImpl = vi.fn()
    await expect(
      fetchGeocodeSearchResults({ q: 'x', lang: 'zh', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('上游 500 返回空数组', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }))
    await expect(
      fetchGeocodeSearchResults({ q: 'x', lang: 'zh', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual([])
  })

  it('上游抛错（超时）返回空数组而不是往外扔', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout')
    })
    await expect(
      fetchGeocodeSearchResults({ q: 'x', lang: 'zh', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual([])
  })

  it('响应不是 JSON 返回空数组', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(
      fetchGeocodeSearchResults({ q: 'x', lang: 'zh', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual([])
  })
})

describe('sortGeocodeResultsByDistance', () => {
  const rows = [
    { title: '远', address: null, lat: 38.77, lng: 127.0 },
    { title: '近', address: null, lat: 34.99, lng: 135.76 },
    { title: '近（同距）', address: null, lat: 34.99, lng: 135.76 },
  ]

  it('无 near 原样返回；有 near 按距离升序且同距保持原顺序', () => {
    expect(sortGeocodeResultsByDistance(rows, null)).toBe(rows)
    expect(sortGeocodeResultsByDistance(rows, { lat: 34.88, lng: 135.8 }).map((row) => row.title)).toEqual(['近', '近（同距）', '远'])
  })
})

describe('geocodeSearch handler', () => {
  function makeHandlers(overrides?: { session?: Session | null }) {
    return createGeocodeSearchHandlers({
      getSession: async () => (overrides?.session === undefined ? ({ user: { id: 'u1' } } as Session) : overrides.session),
      fetchResults: async (input) => {
        if (input.q === 'empty') return []
        return [{ title: input.q, address: '某处', lat: 35.7, lng: 139.56 }]
      },
    })
  }

  it('未登录 401', async () => {
    const res = await makeHandlers({ session: null }).GET(new Request('http://localhost/api/geocode/search?q=x'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '请先登录' })
  })

  it('q 缺失 / 空 / 超过 120 字 → 400 中文消息', async () => {
    const handlers = makeHandlers()
    for (const qs of ['', '   ', 'x'.repeat(121)]) {
      const res = await handlers.GET(new Request(`http://localhost/api/geocode/search?q=${encodeURIComponent(qs)}`))
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(typeof body.error).toBe('string')
      expect(body.error.length).toBeGreaterThan(0)
    }
  })

  it('lang 非法 400；near 非法 400', async () => {
    const handlers = makeHandlers()
    const badLang = await handlers.GET(new Request('http://localhost/api/geocode/search?q=x&lang=fr'))
    expect(badLang.status).toBe(400)
    expect(await badLang.json()).toEqual({ error: 'lang 只支持 zh / en / ja' })

    const badNear = await handlers.GET(new Request('http://localhost/api/geocode/search?q=x&near=abc'))
    expect(badNear.status).toBe(400)
    expect(await badNear.json()).toEqual({ error: 'near 格式应为 lat,lng' })
  })

  it('country：合法值小写去重透传给上游；格式非法（超过 3 个 / 非两位字母）400', async () => {
    const seen: Array<string[] | null | undefined> = []
    const handlers = createGeocodeSearchHandlers({
      getSession: async () => ({ user: { id: 'u-country' } }) as Session,
      fetchResults: async (input) => {
        seen.push(input.country)
        return []
      },
    })
    const ok = await handlers.GET(new Request('http://localhost/api/geocode/search?q=x&country=JP,kr,jp'))
    expect(ok.status).toBe(200)
    expect(seen[0]).toEqual(['jp', 'kr'])

    const none = await handlers.GET(new Request('http://localhost/api/geocode/search?q=x'))
    expect(none.status).toBe(200)
    expect(seen[1]).toBeUndefined()

    for (const bad of ['jp,kr,cn,tw', 'jpn', 'j1', 'jp,']) {
      const res = await handlers.GET(new Request(`http://localhost/api/geocode/search?q=x&country=${encodeURIComponent(bad)}`))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'country 格式应为 1–3 个两位国家代码，逗号分隔（如 jp）' })
    }
  })

  it('合法请求 200 透传结果；空结果 ok:true + results: []', async () => {
    const handlers = makeHandlers()
    const res = await handlers.GET(new Request('http://localhost/api/geocode/search?q=%E5%90%89%E5%8D%9C%E5%8A%9B&lang=ja&near=35.7,139.56'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      results: [{ title: '吉卜力', address: '某处', lat: 35.7, lng: 139.56 }],
    })

    const empty = await handlers.GET(new Request('http://localhost/api/geocode/search?q=empty'))
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual({ ok: true, results: [] })
  })

  it('每用户每分钟 30 次限流，超出 429', async () => {
    const handlers = createGeocodeSearchHandlers({
      getSession: async () => ({ user: { id: 'u-search-rate' } }) as Session,
      fetchResults: async () => [],
    })
    for (let i = 0; i < 30; i++) {
      const res = await handlers.GET(new Request('http://localhost/api/geocode/search?q=x'))
      expect(res.status).toBe(200)
    }
    const limited = await handlers.GET(new Request('http://localhost/api/geocode/search?q=x'))
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: '请求过于频繁，请稍后再试' })
  })
})
