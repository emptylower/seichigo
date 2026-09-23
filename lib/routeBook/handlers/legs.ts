import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { buildDayStops, resolveDayLegs, type LegResolver } from '@/lib/routeBook/legs'
import { routeBookErrorResponse } from './errors'

/** GET /api/me/routebooks/[id]/days/[dayId]/legs — B1 的 resolver 恒返回 null（全 heuristic），B2 接 Google + 缓存 */
export function createLegHandlers(deps: RouteBookApiDeps, resolver: LegResolver = async () => null) {
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

        const sigCache = sig ? { dayId, sig } : undefined
        const [legs, dayGeometry] = await Promise.all([
          resolveDayLegs(stops, agentLegs, day.defaultTravelMode, resolver),
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
