import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { buildDayStops, resolveDayLegs, type LegResolver } from '@/lib/routeBook/legs'
import { routeBookErrorResponse } from './errors'

/** GET /api/me/routebooks/[id]/days/[dayId]/legs — B1 的 resolver 恒返回 null（全 heuristic），B2 接 Google + 缓存 */
export function createLegHandlers(deps: RouteBookApiDeps, resolver: LegResolver = async () => null) {
  return {
    async GET(_req: Request, ctx: { params: Promise<{ id: string; dayId?: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id: routeBookId, dayId } = await ctx.params
      if (!dayId) return NextResponse.json({ error: '缺少 dayId' }, { status: 400 })

      try {
        // A1 瘦身：一条查询拿齐单天上下文（不再 getById 拉整本）；book/天不匹配统一 404
        const dayContext = await deps.repo.getDayContext(routeBookId, userId, dayId)
        if (!dayContext) {
          return NextResponse.json({ error: '行程或该天不存在', reason: 'day_not_found' }, { status: 404 })
        }
        const { day, items, places, lodgings } = dayContext

        const dayItemPointIds = items
          .map((item) => item.pointId)
          .filter((pointId): pointId is string => Boolean(pointId))
        const pointCoords = await deps.pointCoords(dayItemPointIds)

        const { stops, agentLegs, staleTransitItemIds } = buildDayStops(day, items, places, lodgings, pointCoords)

        // A1：legs 计算与整天真实道路几何（缓存读取 → Mapbox）并行；几何失败不影响 legs
        const [legs, dayGeometry] = await Promise.all([
          resolveDayLegs(stops, agentLegs, day.defaultTravelMode, resolver),
          deps.fetchDayGeometry
            ? deps.fetchDayGeometry(
                stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
                day.defaultTravelMode
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
