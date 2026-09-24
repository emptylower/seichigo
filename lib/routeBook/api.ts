import type { Session } from 'next-auth'
import type { PlaceIntro } from '@/lib/googlePlaces/details'
import type { LegResolver } from '@/lib/routeBook/legs'
import type { RouteBookRepo, TravelMode } from '@/lib/routeBook/repo'
import type { PointPoolRepo } from '@/lib/pointPool/repo'

export type RouteBookApiDeps = {
  repo: RouteBookRepo
  pointPoolRepo: PointPoolRepo
  getSession: () => Promise<Session | null>
  now: () => Date
  /** 批量取 AnitabiPoint 坐标（null 坐标不进 Map）；optimize 用（legs 已并入 getDayContext） */
  pointCoords: (pointIds: string[]) => Promise<Map<string, { lat: number; lng: number }>>
  /** B4：导出用点位名（nameZh ?? name）；缺省时导出退化为条目 title */
  pointNames?: (pointIds: string[]) => Promise<Map<string, string>>
  /** A1：整天真实道路几何（Mapbox + RouteLegCache）；缺省/失败返回 null。
   *  A2：sigCache 透传客户端顺序签名，Mapbox/坐标缓存命中后同时回填 sig key */
  fetchDayGeometry?: (
    stops: { lat: number; lng: number }[],
    mode: TravelMode,
    sigCache?: { dayId: string; sig: string }
  ) => Promise<{ type: 'LineString'; coordinates: [number, number][] } | null>
  /** A2：按 sig 直读整天几何缓存（与库查询并行，命中即跳过 Mapbox 路径） */
  readDayGeometryBySig?: (dayId: string, sig: string) => Promise<{ type: 'LineString'; coordinates: [number, number][] } | null>
  /** A3：谷歌点位介绍（Place Details + 缓存）；缺省/上游无结果返回 null */
  placeIntro?: (googlePlaceId: string, lang: 'zh-CN' | 'en' | 'ja') => Promise<PlaceIntro | null>
  /** B2 A2：段级 Google 步行/驾车解析（含 RouteLegCache 缓存）；缺省走 heuristic */
  legResolver?: LegResolver
}

let cached: RouteBookApiDeps | null = null

export async function getRouteBookApiDeps(): Promise<RouteBookApiDeps> {
  if (cached) return cached

  const [
    { PrismaRouteBookRepo },
    { PrismaPointPoolRepo },
    { getServerAuthSession },
    { prisma },
    { resolveDayGeometry, readDayGeometryBySig },
    { createPlaceIntroLookup },
    { createGoogleLegResolver },
  ] = await Promise.all([
    import('@/lib/routeBook/repoPrisma'),
    import('@/lib/pointPool/repoPrisma'),
    import('@/lib/auth/session'),
    import('@/lib/db/prisma'),
    import('@/lib/routeBook/dayGeometry'),
    import('@/lib/routeBook/placeIntro'),
    import('@/lib/routeBook/legResolverGoogle'),
  ])

  cached = {
    repo: new PrismaRouteBookRepo(),
    pointPoolRepo: new PrismaPointPoolRepo(),
    getSession: getServerAuthSession,
    now: () => new Date(),
    pointCoords: async (pointIds) => {
      if (pointIds.length === 0) return new Map()
      const rows = await prisma.anitabiPoint.findMany({
        where: { id: { in: pointIds } },
        select: { id: true, geoLat: true, geoLng: true },
      })
      const map = new Map<string, { lat: number; lng: number }>()
      for (const row of rows) {
        if (row.geoLat == null || row.geoLng == null) continue
        map.set(row.id, { lat: row.geoLat, lng: row.geoLng })
      }
      return map
    },
    pointNames: async (pointIds) => {
      if (pointIds.length === 0) return new Map()
      const rows = await prisma.anitabiPoint.findMany({
        where: { id: { in: pointIds } },
        select: { id: true, name: true, nameZh: true },
      })
      const map = new Map<string, string>()
      for (const row of rows) map.set(row.id, row.nameZh ?? row.name)
      return map
    },
    fetchDayGeometry: resolveDayGeometry,
    readDayGeometryBySig,
    placeIntro: createPlaceIntroLookup(),
    legResolver: createGoogleLegResolver(),
  }

  return cached
}
