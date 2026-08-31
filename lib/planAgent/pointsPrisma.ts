import { prisma } from '@/lib/db/prisma'
import type { AgentPoint, BangumiHit, PointFinder } from './points'

export class PrismaPointFinder implements PointFinder {
  async searchBangumi(query: string, limit: number): Promise<BangumiHit[]> {
    const rows = await prisma.anitabiBangumi.findMany({
      where: {
        mapEnabled: true,
        OR: [
          { titleZh: { contains: query, mode: 'insensitive' } },
          { titleJaRaw: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, titleZh: true, titleJaRaw: true, city: true },
      take: limit,
    })
    return rows
  }

  async countPointsByBangumi(ids: number[]): Promise<Array<{ bangumiId: number; pointCount: number }>> {
    const rows = await prisma.anitabiPoint.groupBy({
      by: ['bangumiId'],
      where: { bangumiId: { in: ids }, geoLat: { not: null }, geoLng: { not: null } },
      _count: { _all: true },
    })
    return rows.map((r) => ({ bangumiId: r.bangumiId, pointCount: r._count._all }))
  }

  async listPoints(bangumiId: number, limit: number): Promise<AgentPoint[]> {
    const rows = await prisma.anitabiPoint.findMany({
      where: { bangumiId, geoLat: { not: null }, geoLng: { not: null } },
      select: { id: true, name: true, nameZh: true, geoLat: true, geoLng: true, ep: true },
      orderBy: [{ density: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: limit,
    })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      nameZh: r.nameZh,
      lat: r.geoLat as number,
      lng: r.geoLng as number,
      ep: r.ep,
    }))
  }

  async getPointsByIds(ids: string[]): Promise<Array<{ id: string; lat: number; lng: number }>> {
    const rows = await prisma.anitabiPoint.findMany({
      where: { id: { in: ids }, geoLat: { not: null }, geoLng: { not: null } },
      select: { id: true, geoLat: true, geoLng: true },
    })
    return rows.map((r) => ({ id: r.id, lat: r.geoLat as number, lng: r.geoLng as number }))
  }
}
