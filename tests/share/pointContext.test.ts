import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryPointContextRepo } from '@/lib/share/pointContextRepoMemory'
import type { PointContextRow } from '@/lib/share/pointContextRepo'
import {
  ANON_DAILY_POINT_CONTEXT_LIMIT,
  createGetPointContextHandler,
  resetPointContextRate,
  type PointContextDeps,
} from '@/lib/share/handlers/pointContext'

const NOW = new Date('2026-09-08T12:00:00Z')

const ROW: PointContextRow = {
  pointId: '101:budo',
  name: '『摇曳露营△ SEASON 3』葡萄牛奶',
  localizedName: null,
  mark: '武州屋 x 远林 x 摇曳露营 推出了联名饮品',
  localizedNote: null,
  geoLat: 35.7,
  geoLng: 139.56,
  localizedBangumiTitle: '摇曳露营△ 三期',
  bangumiTitleCandidates: ['摇曳露营△ SEASON 3', 'ゆるキャン△ SEASON3'],
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
    expect(geocode).toHaveBeenCalledWith({ lat: 35.7, lng: 139.56 })
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
