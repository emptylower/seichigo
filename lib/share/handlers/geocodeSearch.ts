import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { SupportedLocale } from '@/lib/i18n/types'
import { fetchGeocodeSearchResults, type GeocodeSearchInput, type GeocodeSearchResult } from '@/lib/share/geocodeSearch'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// GET /api/geocode/search?q=<text>&lang=<zh|en|ja>&near=<lat,lng> — 正向地址
// 搜索（B2 A1）。登录用户；每用户每分钟 30 次（内存计数）；
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
      })
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数错误' }, { status: 400 })
      }

      const lang = parseLang(url.searchParams.get('lang'))
      if (!lang) return NextResponse.json({ error: 'lang 只支持 zh / en / ja' }, { status: 400 })

      const near = parseNear(parsed.data.near)
      if (near === null) return NextResponse.json({ error: 'near 格式应为 lat,lng' }, { status: 400 })

      const results = await (deps.fetchResults ?? fetchGeocodeSearchResults)({
        q: parsed.data.q,
        lang,
        ...(near ? { near } : {}),
      })
      return NextResponse.json({ ok: true, results })
    },
  }
}
