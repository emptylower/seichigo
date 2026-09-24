import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { z } from 'zod'
import { fetchDailyForecast } from '@/lib/weather/openMeteo'

/**
 * GET /api/weather?lat=&lng=&from=YYYY-MM-DD&to=YYYY-MM-DD
 * → { ok: true, days: [{ date, tMax, tMin, code }] }
 * 登录用户；每用户 60 次/分钟；上游失败按「无天气」降级（ok + 空数组）。
 */

export type WeatherApiDeps = {
  getSession: () => Promise<Session | null>
}

const querySchema = z.object({
  /** 缺失参数不能被 z.coerce.number() 变成 0（'' → 0 会绕过范围校验） */
  lat: z.string().min(1).pipe(z.coerce.number().min(-90).max(90)),
  lng: z.string().min(1).pipe(z.coerce.number().min(-180).max(180)),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
})

type RateEntry = { count: number; windowStart: number }
const rateLimits = new Map<string, RateEntry>()
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX = 60

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  for (const [key, entry] of rateLimits) {
    if (now - entry.windowStart > RATE_WINDOW_MS) rateLimits.delete(key)
  }
  const entry = rateLimits.get(userId)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(userId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_MAX) return false
  entry.count++
  return true
}

export function createWeatherHandlers(deps: WeatherApiDeps) {
  return {
    async GET(req: Request) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      if (!checkRateLimit(userId)) {
        return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 })
      }

      const url = new URL(req.url)
      const parsed = querySchema.safeParse({
        lat: url.searchParams.get('lat') ?? undefined,
        lng: url.searchParams.get('lng') ?? undefined,
        from: url.searchParams.get('from') ?? '',
        to: url.searchParams.get('to') ?? '',
      })
      if (!parsed.success) {
        return NextResponse.json(
          { error: '参数错误：需要 lat/lng 数值与 from/to 日期（YYYY-MM-DD）' },
          { status: 400 },
        )
      }

      const days = await fetchDailyForecast(parsed.data)
      return NextResponse.json({ ok: true, days }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
    },
  }
}
