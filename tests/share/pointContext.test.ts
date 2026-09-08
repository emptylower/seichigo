import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryPointContextRepo } from '@/lib/share/pointContextRepoMemory'
import type { PointContextRow } from '@/lib/share/pointContextRepo'
import {
  ANON_DAILY_POINT_CONTEXT_LIMIT,
  checkPointContextRate,
  createGetPointContextHandler,
  DAILY_GEOCODE_BUDGET,
  pointContextRateSize,
  resetPointContextRate,
  type PointContextDeps,
} from '@/lib/share/handlers/pointContext'

const NOW = new Date('2026-09-08T12:00:00Z')

const ROW: PointContextRow = {
  pointId: '101:budo',
  bangumiId: 101,
  ep: '3',
  scene: '1194',
  image: 'https://image.anitabi.cn/points/101/budo.jpg',
  name: '『摇曳露营△ SEASON 3』葡萄牛奶',
  localizedName: null,
  mark: '武州屋 x 远林 x 摇曳露营 推出了联名饮品',
  localizedNote: null,
  geoLat: 35.7,
  geoLng: 139.56,
  localizedBangumiTitle: '摇曳露营△ 三期',
  bangumiTitleCandidates: ['摇曳露营△ SEASON 3', 'ゆるキャン△ SEASON3'],
  bangumiTitles: { zh: '摇曳露营△', jaRaw: 'ゆるキャン△', original: null, romaji: null, english: null },
}

const ADDRESSES = {
  zh: '东京都 武藏野市 中町一丁目',
  en: 'Nakacho 1-chome, Musashino, Tokyo',
  ja: '東京都 武蔵野市 中町一丁目',
}

function makeDeps(overrides?: {
  repo?: MemoryPointContextRepo
  geocode?: PointContextDeps['geocode']
}): PointContextDeps {
  return {
    repo: overrides?.repo ?? new MemoryPointContextRepo([ROW]),
    geocode: overrides?.geocode ?? (async () => ADDRESSES),
    now: () => NOW,
  }
}

function makeRequest(query: string, ip: string | null = '1.2.3.4') {
  const headers: Record<string, string> = {}
  if (ip !== null) headers['cf-connecting-ip'] = ip
  return new Request(`https://seichigo.com/api/share/point-context?${query}`, { headers })
}

beforeEach(() => {
  resetPointContextRate()
})

describe('GET /api/share/point-context', () => {
  it('缓存未命中时调一次上游、写回缓存并返回该语言的地址', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const geocode = vi.fn(async () => ADDRESSES)
    const res = await createGetPointContextHandler(makeDeps({ repo, geocode }))(
      makeRequest('pointId=101%3Abudo&locale=zh'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      address: ADDRESSES.zh,
      geo: [35.7, 139.56],
      note: ROW.mark,
      inJapan: true,
      displayName: '葡萄牛奶',
      animeTitle: '摇曳露营△ 三期',
    })
    expect(geocode).toHaveBeenCalledTimes(1)
    expect(geocode).toHaveBeenCalledWith({ lat: 35.7, lng: 139.56, includeCountry: false })
    expect((await repo.findAddress('101:budo'))?.addressJa).toBe(ADDRESSES.ja)
  })

  it('缓存命中时不再调上游', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    await repo.saveAddress({ pointId: '101:budo', ...{ addressZh: ADDRESSES.zh, addressEn: ADDRESSES.en, addressJa: ADDRESSES.ja }, source: 'maptiler' })
    const geocode = vi.fn(async () => ADDRESSES)
    const res = await createGetPointContextHandler(makeDeps({ repo, geocode }))(
      makeRequest('pointId=101%3Abudo&locale=ja'),
    )
    expect((await res.json()).address).toBe(ADDRESSES.ja)
    expect(geocode).not.toHaveBeenCalled()
  })

  it('en 取 addressEn', async () => {
    const res = await createGetPointContextHandler(makeDeps())(makeRequest('pointId=101%3Abudo&locale=en'))
    expect((await res.json()).address).toBe(ADDRESSES.en)
  })

  it('地理编码失败：address 为 null，不写缓存，仍返回 200', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const res = await createGetPointContextHandler(makeDeps({ repo, geocode: async () => null }))(
      makeRequest('pointId=101%3Abudo&locale=zh'),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).address).toBeNull()
    expect(await repo.findAddress('101:budo')).toBeNull()
  })

  it('三语全空的地理编码结果不写缓存', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    await createGetPointContextHandler(
      makeDeps({ repo, geocode: async () => ({ zh: null, en: null, ja: null }) }),
    )(makeRequest('pointId=101%3Abudo&locale=zh'))
    expect(await repo.findAddress('101:budo')).toBeNull()
  })

  it('无坐标：不调上游，geo/address 为 null 且 inJapan 为 false', async () => {
    const repo = new MemoryPointContextRepo([{ ...ROW, geoLat: null, geoLng: null }])
    const geocode = vi.fn(async () => ADDRESSES)
    const res = await createGetPointContextHandler(makeDeps({ repo, geocode }))(
      makeRequest('pointId=101%3Abudo&locale=zh'),
    )
    const json = await res.json()
    expect(json.geo).toBeNull()
    expect(json.address).toBeNull()
    expect(json.inJapan).toBe(false)
    expect(geocode).not.toHaveBeenCalled()
  })

  it('海外坐标 inJapan 为 false 但仍给地址', async () => {
    const repo = new MemoryPointContextRepo([{ ...ROW, geoLat: 37.5665, geoLng: 126.978 }])
    const res = await createGetPointContextHandler(makeDeps({ repo }))(
      makeRequest('pointId=101%3Abudo&locale=zh'),
    )
    const json = await res.json()
    expect(json.inJapan).toBe(false)
    expect(json.address).toBe(ADDRESSES.zh)
  })

  it('海外点位地址带 country 段并请求上游包含国家（旧金山 fixture）', async () => {
    const SF_ADDRESSES = {
      zh: '美国 加利福尼亚州 旧金山',
      en: 'San Francisco, California, United States',
      ja: 'アメリカ カリフォルニア州 サンフランシスコ',
    }
    const repo = new MemoryPointContextRepo([{ ...ROW, geoLat: 37.7749, geoLng: -122.4194 }])
    const geocode = vi.fn(async () => SF_ADDRESSES)
    const res = await createGetPointContextHandler(makeDeps({ repo, geocode }))(
      makeRequest('pointId=101%3Abudo&locale=zh'),
    )
    const json = await res.json()
    expect(json.inJapan).toBe(false)
    expect(json.address).toBe('美国 加利福尼亚州 旧金山')
    expect(geocode).toHaveBeenCalledWith({ lat: 37.7749, lng: -122.4194, includeCountry: true })
    // 写回缓存的也是带 country 的地址，缓存命中后无需再拼
    expect((await repo.findAddress('101:budo'))?.addressEn).toBe(SF_ADDRESSES.en)
  })

  it('i18n 的 name/note 优先于原始 name/mark', async () => {
    const repo = new MemoryPointContextRepo([
      { ...ROW, localizedName: 'ゆるキャン△ SEASON3 ぶどうみるく', localizedNote: 'コラボドリンク' },
    ])
    const res = await createGetPointContextHandler(makeDeps({ repo }))(
      makeRequest('pointId=101%3Abudo&locale=ja'),
    )
    const json = await res.json()
    expect(json.displayName).toBe('ぶどうみるく')
    expect(json.note).toBe('コラボドリンク')
  })

  it('localizedBangumiTitle 缺失时 animeTitle 按 locale 兜底', async () => {
    const repo = new MemoryPointContextRepo([
      {
        ...ROW,
        localizedBangumiTitle: null,
        bangumiTitles: { zh: null, jaRaw: 'ゆるキャン△', original: 'Yuru Camp', romaji: 'Yuru Kyampu', english: null },
        bangumiTitleCandidates: ['候补标题'],
      },
    ])
    const handler = createGetPointContextHandler(makeDeps({ repo }))
    // ja：jaRaw 优先，original 其次
    const ja = await (await handler(makeRequest('pointId=101%3Abudo&locale=ja'))).json()
    expect(ja.animeTitle).toBe('ゆるキャン△')
    const jaOriginal = await (
      await createGetPointContextHandler(
        makeDeps({
          repo: new MemoryPointContextRepo([
            { ...ROW, localizedBangumiTitle: null, bangumiTitleCandidates: ['候补标题'], bangumiTitles: { zh: null, jaRaw: null, original: 'Yuru Camp', romaji: null, english: null } },
          ]),
        }),
      )(makeRequest('pointId=101%3Abudo&locale=ja'))
    ).json()
    expect(jaOriginal.animeTitle).toBe('Yuru Camp')
    // en：english 优先，romaji 其次
    const en = await (await handler(makeRequest('pointId=101%3Abudo&locale=en'))).json()
    expect(en.animeTitle).toBe('Yuru Kyampu')
    // zh：只用 zh，缺失退到 candidates[0]
    const zh = await (await handler(makeRequest('pointId=101%3Abudo&locale=zh'))).json()
    expect(zh.animeTitle).toBe('候补标题')
  })

  it('响应带一天的公共缓存头', async () => {
    const res = await createGetPointContextHandler(makeDeps())(makeRequest('pointId=101%3Abudo&locale=zh'))
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
  })

  it('有坐标但拿不到地址时公共缓存缩到 5 分钟', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const res = await createGetPointContextHandler(makeDeps({ repo, geocode: async () => null }))(
      makeRequest('pointId=101%3Abudo&locale=zh'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
  })

  it('locale 非法时退回 zh', async () => {
    const res = await createGetPointContextHandler(makeDeps())(makeRequest('pointId=101%3Abudo&locale=fr'))
    expect((await res.json()).address).toBe(ADDRESSES.zh)
  })

  it('pointId 缺失 / 含 .. / 含非法字符都是 400', async () => {
    const handler = createGetPointContextHandler(makeDeps())
    for (const query of ['locale=zh', 'pointId=..%2Fetc&locale=zh', 'pointId=a%20b&locale=zh']) {
      const res = await handler(makeRequest(query))
      expect(res.status, query).toBe(400)
      expect(await res.json()).toEqual({ error: '参数不合法' })
    }
  })

  it('点位不存在返回 404', async () => {
    const res = await createGetPointContextHandler(makeDeps())(makeRequest('pointId=999%3Anope&locale=zh'))
    expect(res.status).toBe(404)
  })

  it('同一 IP 超过每日上限返回 429', async () => {
    const handler = createGetPointContextHandler(makeDeps())
    for (let i = 0; i < ANON_DAILY_POINT_CONTEXT_LIMIT; i++) {
      const res = await handler(makeRequest('pointId=101%3Abudo&locale=zh'))
      expect(res.status).toBe(200)
    }
    const res = await handler(makeRequest('pointId=101%3Abudo&locale=zh'))
    expect(res.status).toBe(429)
  })

  it('不同 IP 各算各的', async () => {
    const handler = createGetPointContextHandler(makeDeps())
    for (let i = 0; i < ANON_DAILY_POINT_CONTEXT_LIMIT; i++) {
      await handler(makeRequest('pointId=101%3Abudo&locale=zh', '1.1.1.1'))
    }
    expect((await handler(makeRequest('pointId=101%3Abudo&locale=zh', '1.1.1.1'))).status).toBe(429)
    expect((await handler(makeRequest('pointId=101%3Abudo&locale=zh', '2.2.2.2'))).status).toBe(200)
  })

  it('拿不到 cf-connecting-ip（本地开发）不限流也不报错', async () => {
    const res = await createGetPointContextHandler(makeDeps())(
      makeRequest('pointId=101%3Abudo&locale=zh', null),
    )
    expect(res.status).toBe(200)
  })
})

describe('checkPointContextRate 跨日清理', () => {
  const TODAY = new Date('2026-09-08T12:00:00Z')
  const YESTERDAY = new Date('2026-09-07T12:00:00Z')

  it('跨日且条数超过 5000 时删掉所有非当日 key', () => {
    for (let i = 0; i < 5001; i++) checkPointContextRate(`stale-${i}`, YESTERDAY)
    expect(pointContextRateSize()).toBe(5001)
    // 跨日后的第一笔请求触发清理：5001 条昨日 key 全删，只剩当日新 entry
    expect(checkPointContextRate('today-1', TODAY)).toBe(true)
    expect(pointContextRateSize()).toBe(1)
    expect(checkPointContextRate('today-2', TODAY)).toBe(true)
    expect(pointContextRateSize()).toBe(2)
  })

  it('条数不超过 5000 时不清理', () => {
    for (let i = 0; i < 100; i++) checkPointContextRate(`stale-${i}`, YESTERDAY)
    checkPointContextRate('fresh', TODAY)
    expect(pointContextRateSize()).toBe(101)
  })
})

describe('全局每日地理编码预算', () => {
  it('预算耗尽时 geocode 不被调用，address 留 null 且按短缓存返回', async () => {
    const repo = new MemoryPointContextRepo([ROW], () => NOW)
    for (let i = 0; i < DAILY_GEOCODE_BUDGET; i++) {
      await repo.saveAddress({
        pointId: `budget:${i}`,
        addressZh: '东京都',
        addressEn: null,
        addressJa: null,
        source: 'maptiler',
      })
    }
    const geocode = vi.fn(async () => ADDRESSES)
    const res = await createGetPointContextHandler(makeDeps({ repo, geocode }))(
      makeRequest('pointId=101%3Abudo&locale=zh'),
    )
    expect(geocode).not.toHaveBeenCalled()
    expect((await res.json()).address).toBeNull()
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
  })

  it('预算未耗尽时照常回填', async () => {
    const repo = new MemoryPointContextRepo([ROW], () => NOW)
    await repo.saveAddress({
      pointId: 'budget:1',
      addressZh: '东京都',
      addressEn: null,
      addressJa: null,
      source: 'maptiler',
    })
    const geocode = vi.fn(async () => ADDRESSES)
    const res = await createGetPointContextHandler(makeDeps({ repo, geocode }))(
      makeRequest('pointId=101%3Abudo&locale=zh'),
    )
    expect(geocode).toHaveBeenCalledTimes(1)
    expect((await res.json()).address).toBe(ADDRESSES.zh)
  })
})

describe('point-context 响应体不因卡片改造而变宽', () => {
  it('只返回既有的六个字段', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const handler = createGetPointContextHandler({
      repo,
      geocode: async () => null,
      now: () => NOW,
    })
    const res = await handler(new Request('https://x/api/share/point-context?pointId=101:budo'))
    expect(Object.keys(await res.json()).sort()).toEqual(
      ['address', 'animeTitle', 'displayName', 'geo', 'inJapan', 'note'].sort(),
    )
  })
})
