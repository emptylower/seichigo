/**
 * Open-Meteo 每日天气预报（免 key）。
 * - 时区固定 Asia/Tokyo（行程本主要面向日本巡礼）。
 * - 预报窗口 16 天：日期裁剪到「今天 .. 今天+15」（东京当地日）；窗口外交集返回 []。
 * - 任何失败（网络/解析/非 2xx）返回 []，由调用方按「无天气」降级。
 */

export type WeatherDay = { date: string; tMax: number; tMin: number; code: number }
export type FetchDailyForecastInput = { lat: number; lng: number; from: string; to: string }
export type FetchDailyForecastDeps = { now?: () => Date; fetchImpl?: typeof fetch }

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'
const TIMEZONE = 'Asia/Tokyo'
const FORECAST_WINDOW_DAYS = 15 // 今天 + 15 = 16 天
const TIMEOUT_MS = 8000

type OpenMeteoDaily = {
  time?: unknown
  weather_code?: unknown
  temperature_2m_max?: unknown
  temperature_2m_min?: unknown
}

function isValidDateStr(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}

/** 东京当地的今天（YYYY-MM-DD） */
export function tokyoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now)
}

function addDays(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : []
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export async function fetchDailyForecast(
  input: FetchDailyForecastInput,
  deps: FetchDailyForecastDeps = {},
): Promise<WeatherDay[]> {
  const { lat, lng, from, to } = input
  if (!isValidDateStr(from) || !isValidDateStr(to) || from > to) return []

  const now = deps.now?.() ?? new Date()
  const today = tokyoToday(now)
  const lastAllowed = addDays(today, FORECAST_WINDOW_DAYS)
  const start = from < today ? today : from
  const end = to > lastAllowed ? lastAllowed : to
  if (start > end) return []

  const url =
    `${FORECAST_BASE}?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=${encodeURIComponent(TIMEZONE)}&start_date=${start}&end_date=${end}`

  try {
    const fetchImpl = deps.fetchImpl ?? fetch
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return []
    const body = (await res.json()) as { daily?: OpenMeteoDaily }
    const daily = body.daily
    if (!daily) return []

    const time = strArray(daily.time)
    const codes = numArray(daily.weather_code)
    const tMax = numArray(daily.temperature_2m_max)
    const tMin = numArray(daily.temperature_2m_min)
    const days: WeatherDay[] = []
    for (let i = 0; i < time.length; i++) {
      const code = codes[i]
      const max = tMax[i]
      const min = tMin[i]
      if (code === undefined || max === undefined || min === undefined) continue
      days.push({
        date: time[i]!,
        tMax: Math.round(max * 10) / 10,
        tMin: Math.round(min * 10) / 10,
        code,
      })
    }
    return days
  } catch {
    return []
  }
}
