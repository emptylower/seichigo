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
      select: { id: true, titleZh: true, titleJaRaw: true, city: true, cover: true },
      take: limit,
    })
    return rows.map((r) => ({ ...r, cover: r.cover ?? null }))
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

  async getPointsByIds(
    ids: string[],
    bangumiIds: number[] = [],
  ): Promise<Array<{ id: string; lat: number; lng: number; image?: string | null }>> {
    const toGeo = (r: { id: string; geoLat: number | null; geoLng: number | null; image: string | null }) => ({
      id: r.id,
      lat: r.geoLat as number,
      lng: r.geoLng as number,
      image: r.image,
    })
    const queryByIds = (candidates: string[]) =>
      prisma.anitabiPoint.findMany({
        where: { id: { in: candidates }, geoLat: { not: null }, geoLng: { not: null } },
        select: { id: true, geoLat: true, geoLng: true, image: true },
      })

    const rows = await queryByIds(ids)
    const found = new Set(rows.map((r) => r.id))
    // 服务端容错：LLM 传了不带 "<bangumiId>:" 前缀的裸 id 时，第一轮精确
    // 匹配会静默落空。仅对未命中且不含 ":" 的 id，用候选 bangumiIds 拼出
    // scoped id 再查一轮；命中则补进结果，id 字段用查询命中的完整形式。
    const bare = ids.filter((id) => !found.has(id) && !id.includes(':'))
    if (!bare.length || !bangumiIds.length) return rows.map(toGeo)

    const candidates = [...new Set(bangumiIds.flatMap((bangumiId) => bare.map((id) => `${bangumiId}:${id}`)))]
    const extra = await queryByIds(candidates)
    const seen = new Set(rows.map((r) => r.id))
    return [...rows, ...extra.filter((r) => !seen.has(r.id))].map(toGeo)
  }
}
