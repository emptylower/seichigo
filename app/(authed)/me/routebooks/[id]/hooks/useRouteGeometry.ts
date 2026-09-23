'use client'

import { useMemo } from 'react'
import type { DayLegsResult } from '../types'
import type { RoutePreviewLeg } from '@/components/route/routePreviewLayers'

/**
 * 把某天 legs 结果换算成 RoutePreviewMap 的分段线（GeoJSON 顺序 [lng, lat]）。
 * B1 全是 heuristic：polyline 为空 → 站点直连虚线；agent/google 段（B2）有折线时实线。
 * enabled=false（路线开关关闭）返回 undefined，地图回退到无分段渲染。
 */
export function useRouteGeometry(
  dayLegs: DayLegsResult | undefined,
  enabled: boolean
): { legs: RoutePreviewLeg[] | undefined } {
  const legs = useMemo<RoutePreviewLeg[] | undefined>(() => {
    if (!enabled || !dayLegs) return undefined
    const stopById = new Map(dayLegs.stops.map((stop) => [stop.id, stop]))
    const out: RoutePreviewLeg[] = []
    for (const leg of dayLegs.legs) {
      let coordinates: [number, number][] = []
      if (leg.polyline && leg.polyline.length >= 2) {
        coordinates = leg.polyline.map(([lat, lng]) => [lng, lat])
      } else {
        const from = stopById.get(leg.fromId)
        const to = stopById.get(leg.toId)
        if (from && to) {
          coordinates = [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ]
        }
      }
      if (coordinates.length >= 2) {
        out.push({ coordinates, dashed: leg.source === 'heuristic' })
      }
    }
    return out
  }, [dayLegs, enabled])

  return { legs }
}
