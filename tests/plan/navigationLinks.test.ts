import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildDayNavigationUrls,
  buildPointNavigationUrl,
  defaultMaxNavigationWaypoints,
} from '@/app/(authed)/plan/[id]/lib/navigationLinks'

afterEach(() => {
  vi.unstubAllGlobals()
})

const pt = (lat: number, lng: number) => ({ lat, lng })

describe('navigationLinks（Google 地图导航链接）', () => {
  it('单点：destination 直拼，起点留空（用户当前位置），travelmode=transit', () => {
    expect(buildPointNavigationUrl(pt(34.8892, 135.8075))).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('34.889200,135.807500')}&travelmode=transit`,
    )
  })

  it('2 点 → 1 段，无 waypoints 参数', () => {
    const urls = buildDayNavigationUrls([pt(34.8892, 135.8075), pt(35.6329, 139.8804)], { maxWaypoints: 9 })
    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe(
      `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('34.889200,135.807500')}&destination=${encodeURIComponent('35.632900,139.880400')}&travelmode=transit`,
    )
    expect(urls[0]).not.toContain('waypoints')
  })

  it('12 点、maxWaypoints=9 → 2 段，第 2 段起点 = 第 1 段终点', () => {
    const points = Array.from({ length: 12 }, (_, i) => pt(35 + i * 0.01, 135 + i * 0.01))
    const urls = buildDayNavigationUrls(points, { maxWaypoints: 9 })
    expect(urls).toHaveLength(2)
    // 第 1 段：origin=P0 destination=P10，waypoints=P1..P9（9 个，| 分隔）
    expect(urls[0]).toContain(`origin=${encodeURIComponent('35.000000,135.000000')}`)
    expect(urls[0]).toContain(`destination=${encodeURIComponent('35.100000,135.100000')}`)
    const wp = /waypoints=([^&]+)/.exec(urls[0]!)?.[1] ?? ''
    expect(decodeURIComponent(wp).split('|')).toHaveLength(9)
    // 第 2 段起点 = 第 1 段终点（首尾相接），无 waypoints
    expect(urls[1]).toContain(`origin=${encodeURIComponent('35.100000,135.100000')}`)
    expect(urls[1]).toContain(`destination=${encodeURIComponent('35.110000,135.110000')}`)
    expect(urls[1]).not.toContain('waypoints')
  })

  it('坐标保留 6 位小数且经 encodeURIComponent', () => {
    const url = buildPointNavigationUrl(pt(35.123456789, 135.1))
    expect(url).toContain(encodeURIComponent('35.123457,135.100000'))
    expect(url).toContain('%2C')
  })

  it('0/1 个点：1 个点退化为单点导航；0 个返回空', () => {
    expect(buildDayNavigationUrls([], { maxWaypoints: 9 })).toEqual([])
    expect(buildDayNavigationUrls([pt(35, 135)], { maxWaypoints: 9 })).toEqual([
      buildPointNavigationUrl(pt(35, 135)),
    ])
  })

  it('默认 maxWaypoints：无 window（SSR）按桌面 9；pointer:coarse 按移动端 3', () => {
    expect(defaultMaxNavigationWaypoints()).toBe(9)
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }),
    })
    expect(defaultMaxNavigationWaypoints()).toBe(3)
    vi.unstubAllGlobals()
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })
    expect(defaultMaxNavigationWaypoints()).toBe(9)
  })

  it('M7：buildDayNavigationUrls 缺省 maxWaypoints 恒为 9——纯函数自己不读 matchMedia', () => {
    // 即使环境是 coarse 指针，缺省也按 9 切（移动端 3 由调用方在 useEffect 后显式传入）
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    })
    const points = Array.from({ length: 12 }, (_, i) => pt(35 + i * 0.01, 135 + i * 0.01))
    expect(buildDayNavigationUrls(points)).toHaveLength(2)
  })
})
