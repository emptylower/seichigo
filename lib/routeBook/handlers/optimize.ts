import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import { assertAnchorOrder, isAnchor } from '@/lib/routeBook/rules'
import { resolveDayAnchors } from '@/lib/routeBook/anchors'
import { optimizeDay, routeDistanceM, type LatLng, type OptimizePoint } from '@/lib/routeBook/optimize'
import { routeBookErrorResponse } from './errors'

/** POST /api/me/routebooks/[id]/days/[dayId]/optimize */
export function createOptimizeHandlers(deps: RouteBookApiDeps) {
  return {
    async POST(_req: Request, ctx: { params: Promise<{ id: string; dayId?: string }> }) {
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

        const dayItems = detail.items
          .filter((item) => item.dayId === dayId)
          .sort((a, b) => a.sortOrder - b.sortOrder)

        const pointIds = dayItems.map((item) => item.pointId).filter((pointId): pointId is string => Boolean(pointId))
        const coordsByPointId = await deps.pointCoords(pointIds)
        const coordsByPlaceId = new Map(detail.places.map((place) => [place.id, { lat: place.lat, lng: place.lng }]))

        const coordsOf = (item: (typeof dayItems)[number]): LatLng | null => {
          if (item.kind === 'point' && item.pointId) return coordsByPointId.get(item.pointId) ?? null
          if (item.kind === 'place' && item.placeId) return coordsByPlaceId.get(item.placeId) ?? null
          return null
        }

        const anchors = resolveDayAnchors(day.dayIndex, detail.lodgings, detail.places)
        const points: OptimizePoint[] = dayItems.map((item) => {
          const coords = coordsOf(item)
          const fixed = isAnchor(item) || item.kind === 'note' || item.kind === 'transit' || coords === null
          return { id: item.id, lat: coords?.lat ?? Number.NaN, lng: coords?.lng ?? Number.NaN, fixed }
        })

        const before = points.map((point) => point.id)
        const withCoordsBefore = dayItems
          .map((item) => ({ id: item.id, coords: coordsOf(item) }))
          .filter((entry): entry is { id: string; coords: LatLng } => entry.coords !== null)
        const distanceBeforeM = routeDistanceM(
          withCoordsBefore.map((entry) => entry.coords),
          anchors
        )

        const after = optimizeDay(points, anchors)

        const byId = new Map(dayItems.map((item) => [item.id, item]))
        const reorderedItems = after.map((id) => byId.get(id)).filter((item): item is (typeof dayItems)[number] => Boolean(item))
        try {
          assertAnchorOrder(reorderedItems)
        } catch {
          return NextResponse.json({ error: '优化结果与时间锚冲突，请先调整锁定条目', reason: 'anchor_order' }, { status: 409 })
        }

        const withCoordsAfter = after
          .map((id) => (id ? byId.get(id) : undefined))
          .map((item) => (item ? coordsOf(item) : null))
          .filter((coords): coords is LatLng => coords !== null)
        const distanceAfterM = routeDistanceM(withCoordsAfter, anchors)

        const result = await deps.repo.replaceDayOrder(routeBookId, userId, dayId, after)
        return NextResponse.json({
          ok: true,
          before,
          after,
          distanceBeforeM: Math.round(distanceBeforeM),
          distanceAfterM: Math.round(distanceAfterM),
          items: result.items,
          bookUpdatedAt: result.bookUpdatedAt.toISOString(),
        })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
