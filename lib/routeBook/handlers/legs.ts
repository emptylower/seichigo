import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { buildDayStops, resolveDayLegs, type LegResolver } from '@/lib/routeBook/legs'
import { createLegPoolResolver } from '@/lib/routeBook/legPool'
import { routeBookErrorResponse } from './errors'

// ---------------------------------------------------------------------------
// GET /api/me/routebooks/[id]/days/[dayId]/legs — 段序列 + 交通估算。
// B2 A2：resolver 默认取 deps.legResolver（Prisma 工厂注入 Google 实现），
// 经 createLegPoolResolver 包一层：批量缓存读 + 并发 4 + 整体 8 秒截止，
// 超时/失败的段降级 heuristic。每用户每分钟 10 次。
// ---------------------------------------------------------------------------

type RateEntry = { count: number; windowStart: number }
const rateLimits = new Map<string, RateEntry>()
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX = 10

function checkRateLimit(userId: string, max: number): boolean {
  const now = Date.now()
  const entry = rateLimits.get(userId)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(userId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

const nullResolver: LegResolver = async () => null

export function createLegHandlers(
  deps: RouteBookApiDeps,
  resolver?: LegResolver,
  opts?: { rateLimitMax?: number }
) {
  return {
    async GET(req: Request, ctx: { params: Promise<{ id: string; dayId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      if (!checkRateLimit(userId, opts?.rateLimitMax ?? RATE_MAX)) {
        return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 })
      }

      const { id: routeBookId, dayId } = await ctx.params
      if (!dayId) return NextResponse.json({ error: '缺少 dayId' }, { status: 400 })

      // A2：客户端顺序签名（不透明 key，截 64 字符；空/缺省退回原流程）
      const rawSig = new URL(req.url).searchParams.get('sig')
      const sig = rawSig ? rawSig.slice(0, 64) : null

      try {
        // A2 热路径：天上下文（含条目坐标）与 sig 缓存读并行，各一次往返；命中即跳过 Mapbox 路径
        const [dayContext, sigGeometry] = await Promise.all([
          deps.repo.getDayContext(routeBookId, userId, dayId),
          sig && deps.readDayGeometryBySig
            ? deps.readDayGeometryBySig(dayId, sig).catch(() => null)
            : Promise.resolve(null),
        ])
        if (!dayContext) {
          return NextResponse.json({ error: '行程或该天不存在', reason: 'day_not_found' }, { status: 404 })
        }
        const { day, items, places, lodgings, pointCoords } = dayContext

        const { stops, agentLegs, staleTransitItemIds } = buildDayStops(day, items, places, lodgings, pointCoords)

        const baseResolver = resolver ?? deps.legResolver ?? null
        const legResolver = baseResolver ? await createLegPoolResolver(baseResolver, stops, day.defaultTravelMode) : nullResolver

        const sigCache = sig ? { dayId, sig } : undefined
        const [legs, dayGeometry] = await Promise.all([
          resolveDayLegs(stops, agentLegs, day.defaultTravelMode, legResolver),
          sigGeometry
            ? Promise.resolve(sigGeometry)
            : deps.fetchDayGeometry
              ? deps.fetchDayGeometry(
                  stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
                  day.defaultTravelMode,
                  sigCache
                ).catch(() => null)
              : Promise.resolve(null),
        ])

        return NextResponse.json(
          { ok: true, stops, legs, staleTransitItemIds, dayGeometry },
          { headers: { 'Cache-Control': 'private, max-age=0' } }
        )
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
