import { describe, it, expect, vi, type Mock } from 'vitest'
import {
  decodePolyline,
  fetchGoogleDirections,
  parseRouteLegs,
  readOverviewPolyline,
  requestTravel,
} from '@/lib/directions/googleClient'

function googleBody(legs: unknown[], overview?: string) {
  return {
    ok: true,
    json: async () => ({
      status: 'OK',
      routes: [
        {
          legs,
          ...(overview ? { overview_polyline: { points: overview } } : {}),
        },
      ],
    }),
  } as unknown as Response
}

function transitLeg() {
  return {
    start_address: '京都駅',
    end_address: '宇治駅',
    duration: { text: '35 mins', value: 2100 },
    distance: { text: '18.5 km', value: 18500 },
    steps: [
      {
        travel_mode: 'WALKING',
        html_instructions: '步行到 <b>京都站八条口</b>',
        duration: { text: '3 mins', value: 180 },
        distance: { text: '0.2 km', value: 200 },
      },
      {
        travel_mode: 'TRANSIT',
        html_instructions: '乘坐 <b>JR奈良线</b>',
        duration: { text: '28 mins', value: 1680 },
        distance: { text: '17.7 km', value: 17700 },
        transit_details: {
          line: { short_name: 'JR奈良线', name: '奈良線' },
          departure_stop: { name: '京都駅' },
          arrival_stop: { name: '宇治駅' },
          num_stops: 4,
          departure_time: { text: '10:14' },
          arrival_time: { text: '10:42' },
        },
      },
      {
        travel_mode: 'WALKING',
        html_instructions: '步行至 <b>宇治桥</b>',
        duration: { text: '4 mins', value: 240 },
        distance: { text: '0.3 km', value: 300 },
      },
    ],
  }
}

describe('parseRouteLegs（步行/公交/自驾/混合分段解析）', () => {
  it('transit 混合行程保留全部 leg/step：步行段 + 线路名/上下车站/站数/时刻', () => {
    const legs = parseRouteLegs({
      status: 'OK',
      routes: [{ legs: [transitLeg()] }],
    } as never)
    expect(legs).toHaveLength(1)
    const steps = legs[0].steps
    expect(steps.map((s) => s.travelMode)).toEqual(['WALKING', 'TRANSIT', 'WALKING'])
    expect(steps[0].instruction).not.toContain('<') // HTML 已剥离
    const transit = steps[1].transitDetails
    expect(transit).toMatchObject({
      lineName: 'JR奈良线',
      departureStop: '京都駅',
      arrivalStop: '宇治駅',
      numStops: 4,
      departureTime: '10:14',
      arrivalTime: '10:42',
    })
  })

  it('walking / driving 请求同样解析（无 transitDetails）', () => {
    const legs = parseRouteLegs({
      status: 'OK',
      routes: [
        {
          legs: [
            {
              steps: [
                { travel_mode: 'DRIVING', html_instructions: '向西出发', duration: { text: '5 mins', value: 300 }, distance: { text: '2 km', value: 2000 } },
              ],
            },
          ],
        },
      ],
    } as never)
    expect(legs[0].steps[0].travelMode).toBe('DRIVING')
    expect(legs[0].steps[0].transitDetails).toBeNull()
  })

  it('空 routes / null body → 空数组', () => {
    expect(parseRouteLegs({ status: 'OK', routes: [] })).toEqual([])
    expect(parseRouteLegs(null)).toEqual([])
    expect(readOverviewPolyline({ status: 'OK', routes: [] })).toBeNull()
  })
})

describe('decodePolyline', () => {
  it('正确解码 Google 官方文档示例（[lat, lng]，5 位小数精度）', () => {
    // 文档示例前两点：(38.5, -120.2) → (40.7, -120.95)
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC')
    expect(decoded).toHaveLength(2)
    expect(decoded[0]).toEqual([38.5, -120.2])
    expect(decoded[1]).toEqual([40.7, -120.95])
  })

  it('连续点按增量累加（第三点 43.252, -126.453）', () => {
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(decoded).toHaveLength(3)
    expect(Math.abs(decoded[2][0] - 43.252)).toBeLessThan(0.001)
    expect(Math.abs(decoded[2][1] - -126.453)).toBeLessThan(0.001)
  })
})

describe('fetchGoogleDirections', () => {
  it('请求 URL 携带 mode/origin/destination，精确日期时携带 departure_time', async () => {
    const fetchImpl = vi.fn(async () => googleBody([]))
    await fetchGoogleDirections({
      origin: '34.89,135.77',
      destination: '34.98,135.75',
      mode: 'transit',
      departureTimeSec: 1789453200,
      apiKey: 'k',
      fetchImpl,
    })
    const url = new URL(String((fetchImpl as Mock).mock.calls[0]![0]))
    expect(url.searchParams.get('mode')).toBe('transit')
    expect(url.searchParams.get('departure_time')).toBe('1789453200')
    expect(url.searchParams.get('key')).toBe('k')
  })

  it('无 departureTimeSec 时不带 departure_time 参数', async () => {
    const fetchImpl = vi.fn(async () => googleBody([]))
    await fetchGoogleDirections({ origin: 'a', destination: 'b', mode: 'walking', apiKey: 'k', fetchImpl })
    const url = new URL(String((fetchImpl as Mock).mock.calls[0]![0]))
    expect(url.searchParams.has('departure_time')).toBe(false)
    expect(url.searchParams.get('mode')).toBe('walking')
  })
})

describe('requestTravel（agent 用的真实交通查询）', () => {
  const base = {
    origin: { lat: 34.89, lng: 135.77 },
    destination: { lat: 34.98, lng: 135.75 },
    apiKey: 'k',
  }

  it('混合步+公交行程：transfers/walkSeconds/transitSeconds/polyline 齐全', async () => {
    const fetchImpl = vi.fn(async () => googleBody([transitLeg()], '_piP@_piP'))
    const result = await requestTravel({ ...base, mode: 'transit', fetchImpl })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mode).toBe('transit')
    expect(result.transfers).toBe(0) // 单一 TRANSIT step
    expect(result.walkSeconds).toBe(180 + 240)
    expect(result.transitSeconds).toBe(1680)
    expect(result.durationSeconds).toBe(2100)
    expect(result.polyline).toHaveLength(2)
    expect(result.legs[0].steps).toHaveLength(3)
  })

  it('transit ZERO_RESULTS：不做任何步行静默转换，返回可区分的 zero_results', async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: true, json: async () => ({ status: 'ZERO_RESULTS', routes: [] }) }) as unknown as Response,
    )
    const result = await requestTravel({ ...base, mode: 'transit', fetchImpl })
    expect(result).toMatchObject({ ok: false, code: 'zero_results' })
    if (result.ok) return
    expect(result.message).toContain('不要')
    expect(fetchImpl).toHaveBeenCalledTimes(1) // 绝没有第二次 walking 兜底请求
  })

  it('REQUEST_DENIED / OVER_QUERY_LIMIT → config_error / rate_limited（显式可诊断）', async () => {
    const denied = await requestTravel({
      ...base,
      mode: 'transit',
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ status: 'REQUEST_DENIED' }) }) as unknown as Response),
    })
    expect(denied).toMatchObject({ ok: false, code: 'config_error' })

    const quota = await requestTravel({
      ...base,
      mode: 'driving',
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ status: 'OVER_QUERY_LIMIT' }) }) as unknown as Response),
    })
    expect(quota).toMatchObject({ ok: false, code: 'rate_limited' })
  })

  it('缺 API key → config_error；网络异常 → network_error', async () => {
    const noKey = await requestTravel({ ...base, apiKey: '', mode: 'walking', fetchImpl: vi.fn() })
    expect(noKey).toMatchObject({ ok: false, code: 'config_error' })

    const network = await requestTravel({
      ...base,
      mode: 'walking',
      fetchImpl: vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    })
    expect(network).toMatchObject({ ok: false, code: 'network_error' })
  })
})
