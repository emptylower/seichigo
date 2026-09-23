import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { buildDayStops, computeLegPairs, resolveDayLegs, type LegResolver } from '@/lib/routeBook/legs'
import { createLegPoolResolver } from '@/lib/routeBook/legPool'
import { googleLegCacheRawKey } from '@/lib/routeBook/legResolverGoogle'
import { routeBookErrorResponse } from './errors'

// ---------------------------------------------------------------------------
// GET /api/me/routebooks/[id]/days/[dayId]/legs — 段序列 + 交通估算。
// B2 A2：resolver 默认取 deps.legResolver（Prisma 工厂注入 Google 实现），
// 经 createLegPoolResolver 包一层：批量缓存读 + 并发 4 + 整体 8 秒截止，
// 超时/失败的段降级 heuristic。
// B2 修复 A1：限流不再 429——只有真正会触发 Google 外呼的请求（存在
// walking/driving 段且缓存未全中）才计数，超过每用户 10 次/分钟后该次
// 返回 200 + degraded:'rate_limited'，只读缓存 + heuristic，不调 Google。
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

/** 该次请求是否存在会外呼 Google 的段（walking/driving、非 agent 接管、缓存未命中） */
function wouldCallGoogle(
  pairs: ReturnType<typeof computeLegPairs>,
  pool: { isCached: (raw: string) => boolean }
): boolean {
  return pairs.some(
    (pair) =>
      pair.transport === null &&
      (pair.mode === 'walking' || pair.mode === 'driving') &&
      !pool.isCached(googleLegCacheRawKey(pair.mode, pair.from, pair.to))
  )
}

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
        // 池的上游经间接引用包装：限流降级时可以换成 nullResolver（只读缓存 + heuristic）
        let upstream: LegResolver | null = baseResolver
        const pool = baseResolver
          ? await createLegPoolResolver((from, to, mode, callOpts) => upstream!(from, to, mode, callOpts), stops, day.defaultTravelMode)
          : null
        const legResolver: LegResolver = pool ? pool.resolve : nullResolver

        // B2 修复 A1：只有会外呼 Google 的请求才计数；超限降级为缓存 + heuristic
        let degraded: 'rate_limited' | undefined
        if (pool && wouldCallGoogle(computeLegPairs(stops, agentLegs, day.defaultTravelMode), pool)) {
          if (!checkRateLimit(userId, opts?.rateLimitMax ?? RATE_MAX)) {
            upstream = nullResolver
            degraded = 'rate_limited'
          }
        }

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
          { ok: true, stops, legs, staleTransitItemIds, dayGeometry, ...(degraded ? { degraded } : {}) },
          { headers: { 'Cache-Control': 'private, max-age=0' } }
        )
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
