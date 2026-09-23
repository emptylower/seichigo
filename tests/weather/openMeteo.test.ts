import { describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import { fetchDailyForecast, tokyoToday } from '@/lib/weather/openMeteo'
import { createWeatherHandlers } from '@/lib/weather/handlers/weather'

const NOW = new Date('2026-09-23T02:00:00Z') // 东京 2026-09-23 11:00
const TODAY = '2026-09-23'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response
}

function openMeteoBody(overrides: Partial<Record<'time' | 'weather_code' | 'temperature_2m_max' | 'temperature_2m_min', unknown[]>> = {}): {
  daily: Record<string, unknown>
} {
  return {
    daily: {
      time: ['2026-09-23', '2026-09-24'],
      weather_code: [0, 61],
      temperature_2m_max: [26.34, 21],
      temperature_2m_min: [18.21, 15],
      ...overrides,
    },
  }
}

describe('fetchDailyForecast', () => {
  it('解析 daily 数组并保留 1 位小数', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => jsonResponse(openMeteoBody()))
    const days = await fetchDailyForecast(
      { lat: 35.01, lng: 135.76, from: TODAY, to: '2026-09-24' },
      { now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(days).toEqual([
      { date: '2026-09-23', tMax: 26.3, tMin: 18.2, code: 0 },
      { date: '2026-09-24', tMax: 21, tMin: 15, code: 61 },
    ])

    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toContain('https://api.open-meteo.com/v1/forecast?latitude=35.01&longitude=135.76')
    expect(url).toContain('daily=weather_code,temperature_2m_max,temperature_2m_min')
    expect(url).toContain('timezone=Asia%2FTokyo')
    expect(url).toContain('forecast_days=16')
    // 不带 start_date/end_date（Open-Meteo 以 UTC 校验日期窗口，JST 0–9 点会整段 400）
    expect(url).not.toContain('start_date=')
    expect(url).not.toContain('end_date=')
  })

  it('请求失败 / 非 2xx / JSON 解析失败均返回 []', async () => {
    const reject = vi.fn(async () => {
      throw new Error('network down')
    })
    expect(
      await fetchDailyForecast(
        { lat: 35, lng: 135, from: TODAY, to: TODAY },
        { now: () => NOW, fetchImpl: reject as unknown as typeof fetch },
      ),
    ).toEqual([])

    const notOk = vi.fn(async () => jsonResponse({ daily: {} }, false))
    expect(
      await fetchDailyForecast(
        { lat: 35, lng: 135, from: TODAY, to: TODAY },
        { now: () => NOW, fetchImpl: notOk as unknown as typeof fetch },
      ),
    ).toEqual([])

    const malformed = vi.fn(async () => jsonResponse({}))
    expect(
      await fetchDailyForecast(
        { lat: 35, lng: 135, from: TODAY, to: TODAY },
        { now: () => NOW, fetchImpl: malformed as unknown as typeof fetch },
      ),
    ).toEqual([])
  })

  it('日期裁剪在本地进行：from 提前到今天、to 封顶今天+15，窗口外日期被过滤', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request) =>
      jsonResponse(
        openMeteoBody({
          time: ['2026-09-22', '2026-09-23', '2026-09-24', '2026-10-08', '2026-10-09'],
          weather_code: [95, 0, 61, 1, 2],
          temperature_2m_max: [30, 26.34, 21, 19, 18],
          temperature_2m_min: [22, 18.21, 15, 12, 11],
        }),
      ),
    )
    const days = await fetchDailyForecast(
      { lat: 35, lng: 135, from: '2026-09-01', to: '2026-12-31' },
      { now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toContain('forecast_days=16')
    expect(url).not.toContain('start_date=')
    expect(url).not.toContain('end_date=')
    expect(days.map((d) => d.date)).toEqual(['2026-09-23', '2026-09-24', '2026-10-08'])
  })

  it('JST 0–9 点（UTC 仍是昨天）请求不越界：forecast_days 固定 16，不因东京今天 = UTC 明天而 400', async () => {
    const jst0100 = new Date('2026-09-23T16:00:00Z') // 东京 2026-09-24 01:00
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => jsonResponse(openMeteoBody()))
    const days = await fetchDailyForecast(
      { lat: 35, lng: 135, from: '2026-09-24', to: '2026-10-09' },
      { now: () => jst0100, fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(fetchImpl).toHaveBeenCalledOnce()
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toContain('forecast_days=16')
    expect(url).not.toContain('start_date=')
    expect(url).not.toContain('end_date=')
    // 本地过滤掉窗口前的日期（今天=2026-09-24）
    expect(days.map((d) => d.date)).toEqual(['2026-09-24'])
  })

  it('整段超出 16 天窗口时不发请求，返回 []', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(openMeteoBody()))
    expect(
      await fetchDailyForecast(
        { lat: 35, lng: 135, from: '2026-10-09', to: '2026-10-20' },
        { now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('from > to 或格式非法返回 []；缺失数值的日期被跳过', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(openMeteoBody()))
    const deps = { now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch }
    expect(await fetchDailyForecast({ lat: 35, lng: 135, from: '2026-09-25', to: '2026-09-24' }, deps)).toEqual([])
    expect(await fetchDailyForecast({ lat: 35, lng: 135, from: '2026/09/23', to: '2026-09-24' }, deps)).toEqual([])

    const holes = vi.fn(async () =>
      jsonResponse(
        openMeteoBody({
          time: ['2026-09-23', '2026-09-24'],
          temperature_2m_max: [26, null],
        }),
      ),
    )
    const days = await fetchDailyForecast(
      { lat: 35, lng: 135, from: TODAY, to: '2026-09-24' },
      { now: () => NOW, fetchImpl: holes as unknown as typeof fetch },
    )
    expect(days).toEqual([{ date: '2026-09-23', tMax: 26, tMin: 18.2, code: 0 }])
  })

  it('中间为 null 的数值不引起索引错位：前后日期取值保持正确', async () => {
    const middleNull = vi.fn(async () =>
      jsonResponse(
        openMeteoBody({
          time: ['2026-09-23', '2026-09-24', '2026-09-25'],
          weather_code: [0, 61, 2],
          temperature_2m_max: [26, null, 22.05],
          temperature_2m_min: [18.21, null, 15],
        }),
      ),
    )
    const days = await fetchDailyForecast(
      { lat: 35, lng: 135, from: TODAY, to: '2026-09-25' },
      { now: () => NOW, fetchImpl: middleNull as unknown as typeof fetch },
    )
    expect(days).toEqual([
      { date: '2026-09-23', tMax: 26, tMin: 18.2, code: 0 },
      { date: '2026-09-25', tMax: 22.1, tMin: 15, code: 2 },
    ])
  })

  it('tokyoToday 按东京时区取日（UTC 前一天 23:00 = 东京次日）', () => {
    expect(tokyoToday(new Date('2026-09-23T02:00:00Z'))).toBe('2026-09-23')
    expect(tokyoToday(new Date('2026-09-22T23:30:00Z'))).toBe('2026-09-23')
  })
})

describe('weather handlers', () => {
  const deps = { getSession: async () => ({ user: { id: 'u1' } } as Session) }
  const req = (query: string) => new Request(`http://localhost/api/weather?${query}`)

  it('未登录 401', async () => {
    const res = await createWeatherHandlers({ getSession: async () => null }).GET(req('lat=35&lng=135&from=2026-09-23&to=2026-09-24'))
    expect(res.status).toBe(401)
  })

  it('参数非法 400', async () => {
    const res = await createWeatherHandlers(deps).GET(req('lat=abc&lng=135&from=x&to=y'))
    expect(res.status).toBe(400)
  })

  it('缺失 lat/lng 400（空串不得被 coerce 成 0 绕过范围校验）', async () => {
    const noLat = await createWeatherHandlers(deps).GET(req('lng=135&from=2026-09-23&to=2026-09-24'))
    expect(noLat.status).toBe(400)
    const noLng = await createWeatherHandlers(deps).GET(req('lat=35&from=2026-09-23&to=2026-09-24'))
    expect(noLng.status).toBe(400)
  })

  it('成功返回 ok + days 并带 1 小时公共缓存头', async () => {
    // 本地过滤按真实「东京今天」裁剪，mock 数据与查询窗口都用动态日期，避免时间依赖
    const today = tokyoToday(new Date())
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(
          openMeteoBody({
            time: [today, tomorrow],
            weather_code: [0, 61],
            temperature_2m_max: [26.34, 21],
            temperature_2m_min: [18.21, 15],
          }),
        ) as unknown as Response,
      )
    try {
      const res = await createWeatherHandlers(deps).GET(req(`lat=35.01&lng=135.76&from=${today}&to=${tomorrow}`))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
      const body = (await res.json()) as { ok: boolean; days: unknown[] }
      expect(body.ok).toBe(true)
      expect(body.days).toHaveLength(2)
    } finally {
      fetchMock.mockRestore()
    }
  })
})
