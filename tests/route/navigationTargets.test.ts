import { describe, expect, it } from 'vitest'
import {
  buildDayTargets,
  buildDayNavigationUrls,
  buildPointNavigationUrl,
  buildSingleTargets,
  orderTargets,
  type NavStop,
} from '@/lib/route/navigationTargets'

const TOKYO_STATION: NavStop = { lat: 35.6812, lng: 139.7671, name: '東京駅' }
const SHANGHAI_STOPS: NavStop[] = [
  { lat: 31.2304, lng: 121.4737, name: '人民广场' },
  { lat: 31.2397, lng: 121.4995, name: '东方明珠' },
  { lat: 31.2459, lng: 121.4649, name: '静安寺' },
]

/** 两点地表距离（米） */
function approxDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const toRad = (v: number) => (v / 180) * Math.PI
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const meanLat = toRad((a.lat + b.lat) / 2)
  return Math.hypot(dLng * Math.cos(meanLat), dLat) * R
}

function decodeParam(raw: string): string {
  return decodeURIComponent(raw)
}

function parseAmapUri(url: string): URLSearchParams {
  const query = url.split('?')[1] ?? ''
  return new URLSearchParams(query)
}

describe('buildSingleTargets', () => {
  it('三平台单点 URL', () => {
    const targets = buildSingleTargets(TOKYO_STATION, 'walking')
    expect(targets.map((t) => t.provider)).toEqual(['google', 'apple', 'amap'])

    expect(targets[0]!.url).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=35.681200%2C139.767100&travelmode=walking',
    )
    expect(targets[1]!.url).toBe('https://maps.apple.com/?daddr=35.681200%2C139.767100&dirflg=w')
    const amap = parseAmapUri(targets[2]!.url)
    // 单点 marker 保持 WGS-84（coordinate=wgs84，lng,lat 顺序）
    expect(decodeParam(amap.get('position') ?? '')).toBe('139.767100,35.681200')
    expect(decodeParam(amap.get('name') ?? '')).toBe('東京駅')
    expect(amap.get('coordinate')).toBe('wgs84')
  })

  it('dirflg 随 mode 变化（r/w/d）', () => {
    expect(buildSingleTargets(TOKYO_STATION, 'transit')[1]!.url).toContain('dirflg=r')
    expect(buildSingleTargets(TOKYO_STATION, 'driving')[1]!.url).toContain('dirflg=d')
  })
})

describe('buildDayTargets', () => {
  it('Google 整天 origin/destination/waypoints；Apple 仅起终点；高德网页回退含 from/to', () => {
    const targets = buildDayTargets(SHANGHAI_STOPS, 'transit')
    const google = targets[0]!
    const apple = targets[1]!
    const amap = targets[2]!

    expect(google.url).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=31.230400%2C121.473700&destination=31.245900%2C121.464900&waypoints=31.239700%2C121.499500&travelmode=transit',
    )
    expect(google.urls).toBeUndefined()

    expect(apple.provider).toBe('apple')
    expect(apple.note).toBe('endpointsOnly')
    expect(apple.url).toContain('saddr=31.230400%2C121.473700')
    expect(apple.url).toContain('daddr=31.245900%2C121.464900')
    expect(apple.url).toContain('dirflg=r')

    expect(amap.provider).toBe('amap')
    const web = parseAmapUri(amap.url)
    expect(decodeParam(web.get('from[lnglat]') ?? '')).not.toBe('121.473700,31.230400') // GCJ-02 ≠ WGS-84
    expect(web.get('type')).toBe('bus')
    expect(web.get('via[0][name]')).not.toBeNull()
  })

  it('高德整天坐标为 GCJ-02（上海与 WGS 差 300–900m）', () => {
    const targets = buildDayTargets(SHANGHAI_STOPS, 'driving')
    const amap = targets[2]!

    const android = parseAmapUri(amap.appUrls!.android)
    const dlat = Number(android.get('dlat'))
    const dlon = Number(android.get('dlon'))
    const wgs = SHANGHAI_STOPS[2]!
    expect(approxDistanceM({ lat: dlat, lng: dlon }, wgs)).toBeGreaterThan(300)
    expect(approxDistanceM({ lat: dlat, lng: dlon }, wgs)).toBeLessThan(900)

    const web = parseAmapUri(amap.url)
    const [fromLng, fromLat] = decodeParam(web.get('from[lnglat]') ?? '').split(',').map(Number)
    expect(approxDistanceM({ lat: fromLat, lng: fromLng }, SHANGHAI_STOPS[0]!)).toBeGreaterThan(300)
    expect(approxDistanceM({ lat: fromLat, lng: fromLng }, SHANGHAI_STOPS[0]!)).toBeLessThan(900)

    // 途经点参数：vialons/vialats/vianames 与 GCJ-02 一致
    const vialon = Number((android.get('vialons') ?? '').split(',')[0])
    const vialat = Number((android.get('vialats') ?? '').split(',')[0])
    expect(approxDistanceM({ lat: vialat, lng: vialon }, SHANGHAI_STOPS[1]!)).toBeGreaterThan(300)
    expect(approxDistanceM({ lat: vialat, lng: vialon }, SHANGHAI_STOPS[1]!)).toBeLessThan(900)
    expect(decodeParam(android.get('vianames') ?? '')).toBe('东方明珠')
  })

  it('高德 t 参数按 mode 映射：driving→0 / walking→3 / transit→4；网页 type 同步', () => {
    const driving = buildDayTargets(SHANGHAI_STOPS, 'driving')[2]!
    const walking = buildDayTargets(SHANGHAI_STOPS, 'walking')[2]!
    expect(parseAmapUri(driving.appUrls!.android).get('t')).toBe('0')
    expect(parseAmapUri(walking.appUrls!.ios).get('t')).toBe('3')
    expect(parseAmapUri(walking.url).get('type')).toBe('walk')
  })

  it('名称含逗号时高德列表参数以全角逗号替代，中文正确编码', () => {
    const stops: NavStop[] = [
      { lat: 31.2304, lng: 121.4737, name: 'A,B' },
      { lat: 31.2397, lng: 121.4995, name: '豫园,城隍庙' },
      { lat: 31.2459, lng: 121.4649, name: '静安寺' },
    ]
    const amap = buildDayTargets(stops, 'transit')[2]!
    const android = parseAmapUri(amap.appUrls!.android)
    expect(decodeParam(android.get('vianames') ?? '')).toBe('豫园，城隍庙')
    expect(decodeParam(parseAmapUri(amap.url).get('via[0][name]') ?? '')).toBe('豫园，城隍庙')
  })

  it('Google waypoints 超 9 个分块：url 为首段，urls 含全部首尾相接的分段', () => {
    const stops: NavStop[] = Array.from({ length: 14 }, (_, i) => ({
      lat: 35 + i * 0.001,
      lng: 139 + i * 0.001,
      name: `S${i + 1}`,
    }))
    const [google, ...rest] = buildDayTargets(stops, 'walking')
    expect(rest).toHaveLength(2)
    // 14 点、每段 origin+9 waypoints+destination → 首段 11 点、次段首尾相接共 5 点
    expect(google.urls).toHaveLength(2)
    const first = parseAmapUri(google.url)
    expect(decodeParam(first.get('waypoints') ?? '').split('|')).toHaveLength(9)
    const second = parseAmapUri(google.urls![1]!)
    expect(decodeParam(second.get('origin') ?? '')).toBe(decodeParam(first.get('destination') ?? ''))
  })

  it('空 stops 返回 []；单 stop 退化为单点目标', () => {
    expect(buildDayTargets([], 'transit')).toEqual([])
    const single = buildDayTargets([TOKYO_STATION], 'transit')
    expect(single).toEqual(buildSingleTargets(TOKYO_STATION, 'transit'))
  })
})

describe('orderTargets', () => {
  const targets = buildDayTargets(SHANGHAI_STOPS, 'transit')

  it('iOS → apple, google, amap 且高德 appUrl 为 iosamap://', () => {
    const ordered = orderTargets(targets, { isIOS: true, isAndroid: false, locale: 'zh' })
    expect(ordered.map((t) => t.provider)).toEqual(['apple', 'google', 'amap'])
    expect(ordered[2]!.appUrl).toMatch(/^iosamap:\/\//)
    expect(ordered[2]!.appUrls).toBeUndefined()
  })

  it('zh 非 iOS → amap, google, apple 且高德 appUrl 为 amapuri://', () => {
    const ordered = orderTargets(targets, { isIOS: false, isAndroid: true, locale: 'zh' })
    expect(ordered.map((t) => t.provider)).toEqual(['amap', 'google', 'apple'])
    expect(ordered[0]!.appUrl).toMatch(/^amapuri:\/\//)
  })

  it('其余（en/ja、非 iOS）→ google, apple, amap；桌面无 appUrl', () => {
    const ordered = orderTargets(targets, { isIOS: false, isAndroid: false, locale: 'en' })
    expect(ordered.map((t) => t.provider)).toEqual(['google', 'apple', 'amap'])
    expect(ordered[2]!.appUrl).toBeUndefined()
    expect(ordered[2]!.appUrls).toBeUndefined()
  })
})

describe('/plan 兼容导出（navigationLinks 同名函数）', () => {
  it('buildPointNavigationUrl 固定 transit', () => {
    expect(buildPointNavigationUrl({ lat: 35.6812, lng: 139.7671 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=35.681200%2C139.767100&travelmode=transit',
    )
  })

  it('buildDayNavigationUrls 分块且首尾相接', () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ lat: 35 + i * 0.01, lng: 139 + i * 0.01 }))
    const urls = buildDayNavigationUrls(points)
    expect(urls).toHaveLength(2)
    const first = new URLSearchParams(urls[0]!.split('?')[1])
    const second = new URLSearchParams(urls[1]!.split('?')[1])
    expect(decodeURIComponent(second.get('origin')!)).toBe(decodeURIComponent(first.get('destination')!))
    expect(urls[0]).toContain('travelmode=transit')
  })

  it('1 点退化为单点；0 点为空', () => {
    expect(buildDayNavigationUrls([{ lat: 1, lng: 2 }])).toHaveLength(1)
    expect(buildDayNavigationUrls([])).toEqual([])
  })
})
