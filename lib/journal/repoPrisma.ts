import { prisma } from '@/lib/db/prisma'
import type {
  JournalCheckinRow,
  JournalReadRepo,
  JournalRouteBookRow,
  JournalUserRow,
} from './repo'

export class PrismaJournalReadRepo implements JournalReadRepo {
  async getUser(userId: string): Promise<JournalUserRow | null> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, image: true, bio: true, createdAt: true },
    })
    return row ?? null
  }

  async listCheckins(userId: string): Promise<JournalCheckinRow[]> {
    const rows = await prisma.userPointState.findMany({
      where: { userId, state: 'checked_in' },
      orderBy: { checkedInAt: 'desc' },
      include: {
        point: {
          select: {
            id: true,
            name: true,
            nameZh: true,
            geoLat: true,
            geoLng: true,
            bangumi: {
              select: {
                id: true,
                titleZh: true,
                city: true,
                _count: { select: { points: true } },
              },
            },
          },
        },
      },
    })
    if (rows.length === 0) return []
    const newestId = rows[0].pointId
    return rows.map((r) => ({
      pointId: r.pointId,
      geoLat: r.point.geoLat ?? null,
      geoLng: r.point.geoLng ?? null,
      prefectureZh: r.point.bangumi?.city ?? null,
      workTitle: r.point.bangumi?.titleZh ?? null,
      workId: r.point.bangumi ? String(r.point.bangumi.id) : null,
      totalPointsForWork: r.point.bangumi?._count.points ?? null,
      photoUrl: r.photoUrl,
      placeName: r.point.nameZh ?? r.point.name,
      checkedInAt: r.checkedInAt ?? r.updatedAt,
      isMostRecent: r.pointId === newestId,
    }))
  }

  async listRouteBooks(userId: string): Promise<JournalRouteBookRow[]> {
    const rows = await prisma.routeBook.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { points: true } } },
    })
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      metadata: r.metadata,
      pointCount: r._count.points,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      workTitle: null,
      locationZh: null,
    }))
  }

  async countDistinctWorksVisited(userId: string): Promise<number> {
    const result = await prisma.userPointState.findMany({
      where: { userId, state: 'checked_in' },
      distinct: ['pointId'],
      select: { point: { select: { bangumiId: true } } },
    })
    const works = new Set(result.map((r) => r.point.bangumiId).filter(Boolean))
    return works.size
  }

  async countDistinctPointsVisited(userId: string): Promise<number> {
    return prisma.userPointState.count({
      where: { userId, state: 'checked_in' },
    })
  }

  async countNotesPublished(_userId: string): Promise<number> {
    return 0
  }
}
