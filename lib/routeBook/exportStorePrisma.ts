import { prisma } from '@/lib/db/prisma'
import type { RouteBookExportCreateInput, RouteBookExportStore } from './exportStore'

export class PrismaRouteBookExportStore implements RouteBookExportStore {
  async findBySourcePlanId(userId: string, sourcePlanId: string): Promise<{ id: string } | null> {
    return prisma.routeBook.findFirst({
      where: {
        userId,
        metadata: { path: ['sourcePlanId'], equals: sourcePlanId },
      },
      select: { id: true },
    })
  }

  async createWithPoints(input: RouteBookExportCreateInput): Promise<{ id: string }> {
    return prisma.$transaction(async (tx) => {
      const book = await tx.routeBook.create({
        data: {
          userId: input.userId,
          title: input.title,
          status: input.status,
          metadata: input.metadata,
        },
        select: { id: true },
      })
      await tx.routeBookPoint.createMany({
        data: input.points.map((point) => ({
          routeBookId: book.id,
          pointId: point.pointId,
          zone: point.zone,
          sortOrder: point.sortOrder,
        })),
      })
      return book
    })
  }
}
