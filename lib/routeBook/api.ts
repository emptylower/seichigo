import type { Session } from 'next-auth'
import type { RouteBookRepo, TravelMode } from '@/lib/routeBook/repo'
import type { PointPoolRepo } from '@/lib/pointPool/repo'

export type RouteBookApiDeps = {
  repo: RouteBookRepo
  pointPoolRepo: PointPoolRepo
  getSession: () => Promise<Session | null>
  now: () => Date
  /** 批量取 AnitabiPoint 坐标（null 坐标不进 Map）；optimize/legs 用 */
  pointCoords: (pointIds: string[]) => Promise<Map<string, { lat: number; lng: number }>>
  /** A1：整天真实道路几何（Mapbox + RouteLegCache）；缺省/失败返回 null */
  fetchDayGeometry?: (
    stops: { lat: number; lng: number }[],
    mode: TravelMode
  ) => Promise<{ type: 'LineString'; coordinates: [number, number][] } | null>
}

let cached: RouteBookApiDeps | null = null

export async function getRouteBookApiDeps(): Promise<RouteBookApiDeps> {
  if (cached) return cached

  const [{ PrismaRouteBookRepo }, { PrismaPointPoolRepo }, { getServerAuthSession }, { prisma }, { resolveDayGeometry }] =
    await Promise.all([
      import('@/lib/routeBook/repoPrisma'),
      import('@/lib/pointPool/repoPrisma'),
      import('@/lib/auth/session'),
      import('@/lib/db/prisma'),
      import('@/lib/routeBook/dayGeometry'),
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
    fetchDayGeometry: resolveDayGeometry,
  }

  return cached
}
