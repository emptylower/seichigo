import { Prisma, type UserPointPool as PrismaUserPointPool } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { ListPointPoolFilters, PointPoolRepo, UserPointPoolItem } from '@/lib/pointPool/repo'

function toItem(record: PrismaUserPointPool): UserPointPoolItem {
  return {
    id: record.id,
    userId: record.userId,
    pointId: record.pointId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export class PrismaPointPoolRepo implements PointPoolRepo {
  async upsert(userId: string, pointId: string): Promise<UserPointPoolItem> {
    const saved = await prisma.userPointPool.upsert({
      where: { userId_pointId: { userId, pointId } },
      create: { userId, pointId },
      update: { updatedAt: new Date() },
    })

    return toItem(saved)
  }

  async delete(userId: string, pointId: string): Promise<boolean> {
    try {
      await prisma.userPointPool.delete({ where: { userId_pointId: { userId, pointId } } })
      return true
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return false
      }
      throw err
    }
  }

  async listByUser(userId: string, filters?: ListPointPoolFilters): Promise<UserPointPoolItem[]> {
    const where: Prisma.UserPointPoolWhereInput = {
      userId,
      ...(filters?.bangumiId !== undefined
        ? {
            point: {
              bangumiId: filters.bangumiId,
            },
          }
        : {}),
    }

    const list = await prisma.userPointPool.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })

    return list.map(toItem)
  }

  async has(userId: string, pointId: string): Promise<boolean> {
    const found = await prisma.userPointPool.findUnique({
      where: { userId_pointId: { userId, pointId } },
      select: { id: true },
    })
    return Boolean(found)
  }
}
