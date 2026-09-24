import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { SupportedLocale } from '@/lib/i18n/types'
import { fetchGeocodeSearchResults, type GeocodeSearchInput, type GeocodeSearchResult } from '@/lib/share/geocodeSearch'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// GET /api/geocode/search?q=<text>&lang=<zh|en|ja>&near=<lat,lng>&country=<jp[,kr]>
// — 正向地址搜索（B2 A1）。country 最多 3 个两位代码；有 near 时结果按距离排序。登录用户；每用户每分钟 30 次（内存计数）；
// 无 key 或上游失败 → { ok: true, results: [] }。
// ---------------------------------------------------------------------------

export type GeocodeSearchHandlerDeps = {
  getSession: () => Promise<Session | null>
  /** 上游查询（测试注入用）；缺省 fetchGeocodeSearchResults */
  fetchResults?: (input: GeocodeSearchInput) => Promise<GeocodeSearchResult[]>
}

type RateEntry = { count: number; windowStart: number }
const rateLimits = new Map<string, RateEntry>()
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX = 30

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  // 顺带清理过期条目，避免 Map 随历史用户无界增长（B2 修复 A6）
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

const querySchema = z.object({
  q: z.string().trim().min(1, '搜索词不能为空').max(120, '搜索词最长 120 字'),
  near: z.string().trim().optional(),
  country: z.string().trim().optional(),
})

function parseLang(raw: string | null): SupportedLocale | null {
  if (!raw) return 'zh'
  return raw === 'zh' || raw === 'en' || raw === 'ja' ? raw : null
}

const NEAR_RE = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/

/** undefined = 未传；null = 格式非法 */
function parseNear(raw: string | undefined): { lat: number; lng: number } | null | undefined {
  if (raw === undefined || raw === '') return undefined
  const match = NEAR_RE.exec(raw)
  if (!match) return null
  const lat = Number(match[1])
  const lng = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

const COUNTRY_RE = /^[a-z]{2}(?:,[a-z]{2}){0,2}$/

/** undefined = 未传；null = 格式非法；否则去重后的小写代码列表 */
function parseCountry(raw: string | undefined): string[] | null | undefined {
  if (raw === undefined || raw === '') return undefined
  const value = raw.toLowerCase()
  if (!COUNTRY_RE.test(value)) return null
  return Array.from(new Set(value.split(',')))
}

export function createGeocodeSearchHandlers(deps: GeocodeSearchHandlerDeps) {
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
        q: url.searchParams.get('q') ?? '',
        near: url.searchParams.get('near') ?? undefined,
        country: url.searchParams.get('country') ?? undefined,
      })
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数错误' }, { status: 400 })
      }

      const lang = parseLang(url.searchParams.get('lang'))
      if (!lang) return NextResponse.json({ error: 'lang 只支持 zh / en / ja' }, { status: 400 })

      const near = parseNear(parsed.data.near)
      if (near === null) return NextResponse.json({ error: 'near 格式应为 lat,lng' }, { status: 400 })

      const country = parseCountry(parsed.data.country)
      if (country === null) {
        return NextResponse.json({ error: 'country 格式应为 1–3 个两位国家代码，逗号分隔（如 jp）' }, { status: 400 })
      }

      const results = await (deps.fetchResults ?? fetchGeocodeSearchResults)({
        q: parsed.data.q,
        lang,
        ...(near ? { near } : {}),
        ...(country ? { country } : {}),
      })
      return NextResponse.json({ ok: true, results })
    },
  }
}
