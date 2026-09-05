import { prisma } from '@/lib/db/prisma'
import { toPointPlaceLinkRow, type PointPlaceLinkRow, type PointPlaceLinkStore } from '@/lib/googlePlaces/pointPlaceLink'

/**
 * PointPlaceLinkStore 的 Prisma 实现：AnitabiPoint 上的 googlePlace* 三列。
 * findUnique 只取映射所需列；update 只写映射列，不触碰同步管别的字段。
 */

export function createPrismaPointPlaceLinkStore(): PointPlaceLinkStore {
  return {
    async findPoint(pointId): Promise<PointPlaceLinkRow | null> {
      const row = await prisma.anitabiPoint.findUnique({
        where: { id: pointId },
        select: {
          id: true,
          name: true,
          nameZh: true,
          geoLat: true,
          geoLng: true,
          googlePlaceId: true,
          googlePlaceStatus: true,
          googlePlaceResolvedAt: true,
        },
      })
      return row ? toPointPlaceLinkRow(row) : null
    },
    async setLink(pointId, link): Promise<void> {
      await prisma.anitabiPoint.update({
        where: { id: pointId },
        data: {
          googlePlaceId: link.placeId,
          googlePlaceStatus: link.status,
          googlePlaceResolvedAt: link.resolvedAt,
        },
      })
    },
  }
}

/** 进程级单例（workerd 隔离体内各自持有） */
let singleton: PointPlaceLinkStore | null = null

export function getPrismaPointPlaceLinkStore(): PointPlaceLinkStore {
  if (!singleton) singleton = createPrismaPointPlaceLinkStore()
  return singleton
}
