import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { PLACE_INTRO_LANGS, type PlaceIntroLang } from '@/lib/googlePlaces/details'
import { routeBookErrorResponse } from './errors'

// ---------------------------------------------------------------------------
// GET /api/me/routebooks/[id]/places/[placeId]/intro — 自定义点的谷歌点位介绍
// （B1.1 A3）。鉴权 + 归属校验（place 必须属于本行程本）；无 googlePlaceId
// 或上游无结果 → 404「该地点暂无谷歌信息」。每用户每分钟 30 次。
// ---------------------------------------------------------------------------

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

function parseLang(raw: string | null): PlaceIntroLang | null {
  if (!raw) return 'zh-CN'
  return (PLACE_INTRO_LANGS as readonly string[]).includes(raw) ? (raw as PlaceIntroLang) : null
}

export function createPlaceIntroHandlers(deps: RouteBookApiDeps) {
  return {
    async GET(req: Request, ctx: { params: Promise<{ id: string; placeId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, placeId } = await ctx.params
      if (!placeId) return NextResponse.json({ error: '缺少 placeId' }, { status: 400 })

      if (!checkRateLimit(userId)) {
        return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 })
      }

      const url = new URL(req.url)
      const lang = parseLang(url.searchParams.get('lang'))
      if (!lang) return NextResponse.json({ error: 'lang 只支持 zh-CN / en / ja' }, { status: 400 })

      try {
        const detail = await deps.repo.getById(routeBookId, userId)
        if (!detail) return NextResponse.json({ error: '行程不存在' }, { status: 404 })

        const place = detail.places.find((row) => row.id === placeId)
        if (!place) return NextResponse.json({ error: '自定义点不存在' }, { status: 404 })

        if (!place.googlePlaceId || !deps.placeIntro) {
          return NextResponse.json({ error: '该地点暂无谷歌信息' }, { status: 404 })
        }

        const intro = await deps.placeIntro(place.googlePlaceId, lang)
        if (!intro) return NextResponse.json({ error: '该地点暂无谷歌信息' }, { status: 404 })

        return NextResponse.json({ ok: true, intro })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
