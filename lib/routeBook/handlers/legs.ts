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
        const detail = await deps.repo.getById(routeBookId, userId)
        if (!detail) return NextResponse.json({ error: '行程不存在' }, { status: 404 })
        const day = detail.days.find((row) => row.id === dayId)
        if (!day) return NextResponse.json({ error: '天不存在' }, { status: 404 })

        const dayItemPointIds = detail.items
          .filter((item) => item.dayId === dayId)
          .map((item) => item.pointId)
          .filter((pointId): pointId is string => Boolean(pointId))
        const pointCoords = await deps.pointCoords(dayItemPointIds)

        const { stops, agentLegs, staleTransitItemIds } = buildDayStops(day, detail.items, detail.places, detail.lodgings, pointCoords)
        const legs = await resolveDayLegs(stops, agentLegs, day.defaultTravelMode, resolver)

        // A1：整天真实道路几何（含住宿首尾，同一停靠序列）；失败不影响 legs
        let dayGeometry: { type: 'LineString'; coordinates: [number, number][] } | null = null
        if (deps.fetchDayGeometry) {
          try {
            dayGeometry = await deps.fetchDayGeometry(
              stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
              day.defaultTravelMode
            )
          } catch {
            dayGeometry = null
          }
        }

        return NextResponse.json({ ok: true, stops, legs, staleTransitItemIds, dayGeometry })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
