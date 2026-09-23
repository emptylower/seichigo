'use client'

import { useMemo } from 'react'
import type { DayGeometry, DayLegsResult } from '../types'
import type { RoutePreviewLeg } from '@/components/route/routePreviewLayers'

/**
 * 把某天 legs 结果换算成 RoutePreviewMap 的渲染输入：
 * - 服务端给了 dayGeometry（整天真实道路几何，含住宿首尾）→ 作为单条实线 LineString
 *   走 routeGeometry 通道（亮芯+暗壳样式，与 /plan 一致）；
 * - 没给（无 token / 站点不足）→ 回退到 legs 分段：polyline 段（agent/google）实线，
 *   heuristic 段（两点直连）虚线。
 * enabled=false（路线开关关闭）或 legs 未到：两者都为 null/[]，地图不画线。
 */
export function useRouteGeometry(
  dayLegs: DayLegsResult | undefined,
  enabled: boolean
): { dayGeometry: DayGeometry | null; legs: RoutePreviewLeg[] } {
  const dayGeometry = useMemo<DayGeometry | null>(() => {
    if (!enabled || !dayLegs) return null
    const geometry = dayLegs.dayGeometry
    if (!geometry || geometry.coordinates.length < 2) return null
    return geometry
  }, [dayLegs, enabled])

  const legs = useMemo<RoutePreviewLeg[]>(() => {
    if (!enabled || !dayLegs) return []
    // dayGeometry 在场时由 routeGeometry 通道渲染，分段 legs 只作连接行数据源
    if (dayGeometry) return []
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
  }, [dayLegs, dayGeometry, enabled])

  return { dayGeometry, legs }
}
