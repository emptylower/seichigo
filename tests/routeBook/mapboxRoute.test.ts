import { describe, expect, it, vi } from 'vitest'
import { fetchMapboxRoute } from '@/lib/routeBook/mapboxRoute'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

function okBody(coordinates: [number, number][], distance = 1000, duration = 600) {
  return {
    code: 'Ok',
    routes: [{ geometry: { type: 'LineString', coordinates }, distance, duration }],
  }
}

describe('fetchMapboxRoute URL 拼接', () => {
  it('按 profile/lng,lat 序列/查询参数拼接，token 走 access_token', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(okBody([[135, 35], [135.1, 35.1]])))
    const result = await fetchMapboxRoute(
      [
        { lat: 35.0, lng: 135.0 },
        { lat: 35.1, lng: 135.1 },
      ],
      'walking',
      { token: 'pk-test', fetch: fetchImpl },
    )
    expect(result).toEqual({
      ok: true,
      geometry: { type: 'LineString', coordinates: [[135, 35], [135.1, 35.1]] },
      distance: 1000,
      duration: 600,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      'https://api.mapbox.com/directions/v5/mapbox/walking/135,35;135.1,35.1?geometries=geojson&overview=full&access_token=pk-test',
    )
  })

  it('driving profile 映射到 mapbox/driving', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(okBody([[135, 35], [135.2, 35.2]])))
    await fetchMapboxRoute(
      [
        { lat: 35.0, lng: 135.0 },
        { lat: 35.2, lng: 135.2 },
      ],
      'driving',
      { token: 't', fetch: fetchImpl },
    )
    expect(String(fetchImpl.mock.calls[0]![0]).startsWith('https://api.mapbox.com/directions/v5/mapbox/driving/')).toBe(true)
  })

  it('超过 25 站分片请求：共享边界站，几何拼接、距离时长求和', async () => {
    const stops = Array.from({ length: 27 }, (_, i) => ({ lat: 35 + i * 0.001, lng: 135 + i * 0.001 }))
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const coordPart = url.split('/')[7]!.split('?')[0]!
      const count = coordPart.split(';').length
      return jsonResponse(
        okBody(
          Array.from({ length: count }, (_, i) => [135 + i * 0.001, 35 + i * 0.001]) as [number, number][],
          100,
          10,
        ),
      )
    })
    const result = await fetchMapboxRoute(stops, 'walking', { token: 't', fetch: fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstCoords = (fetchImpl.mock.calls[0]![0] as string).split('/')[7]!.split('?')[0]!.split(';')
    const secondCoords = (fetchImpl.mock.calls[1]![0] as string).split('/')[7]!.split('?')[0]!.split(';')
    expect(firstCoords).toHaveLength(25)
    expect(secondCoords).toHaveLength(3)
    // 第二段以第一段末站开头（共享站点）
    expect(secondCoords[0]).toBe(firstCoords[24])
    expect(result).toMatchObject({ ok: true, distance: 200, duration: 20 })
    if (result.ok) {
      // 25 + (3 - 1) = 27 个坐标
      expect(result.geometry.coordinates).toHaveLength(27)
    }
  })
})

describe('fetchMapboxRoute 错误返回', () => {
  const twoStops = [
    { lat: 35.0, lng: 135.0 },
    { lat: 35.1, lng: 135.1 },
  ]

  it('fetch 抛错 → { ok: false, reason: "fetch" }', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })
    expect(await fetchMapboxRoute(twoStops, 'walking', { token: 't', fetch: fetchImpl })).toEqual({ ok: false, reason: 'fetch' })
  })

  it('HTTP 非 2xx → { ok: false, reason: "http" }', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'Ok' }, false))
    expect(await fetchMapboxRoute(twoStops, 'walking', { token: 't', fetch: fetchImpl })).toEqual({ ok: false, reason: 'http' })
  })

  it('code 不是 Ok → { ok: false, reason: "code" }', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'NoSegment', routes: [] }))
    expect(await fetchMapboxRoute(twoStops, 'walking', { token: 't', fetch: fetchImpl })).toEqual({ ok: false, reason: 'code' })
  })

  it('code Ok 但无路线 → { ok: false, reason: "no_route" }', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'Ok', routes: [] }))
    expect(await fetchMapboxRoute(twoStops, 'walking', { token: 't', fetch: fetchImpl })).toEqual({ ok: false, reason: 'no_route' })
  })

  it('少于 2 站 → { ok: false, reason: "no_route" }，不发起请求', async () => {
    const fetchImpl = vi.fn()
    expect(await fetchMapboxRoute([{ lat: 35, lng: 135 }], 'walking', { token: 't', fetch: fetchImpl })).toEqual({
      ok: false,
      reason: 'no_route',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('分片中任一段失败 → 整体失败', async () => {
    const stops = Array.from({ length: 26 }, (_, i) => ({ lat: 35 + i * 0.001, lng: 135 + i * 0.001 }))
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 2) return jsonResponse({ code: 'NoSegment' })
      return jsonResponse(okBody([[135, 35]]))
    })
    expect(await fetchMapboxRoute(stops, 'walking', { token: 't', fetch: fetchImpl })).toEqual({ ok: false, reason: 'code' })
  })
})
