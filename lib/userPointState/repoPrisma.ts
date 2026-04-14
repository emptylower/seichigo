import type { Prisma, UserPointState as PrismaUserPointState } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { isPrismaKnownRequestError } from '@/lib/db/prismaError'
import type { UserPointState, UserPointStateRepo, UserPointStateValue, UpsertUserPointStateOpts, ListByUserFilters } from './repo'

function toUserPointState(record: PrismaUserPointState): UserPointState {
  return {
    ...record,
    state: record.state as UserPointStateValue,
  }
}

export class PrismaUserPointStateRepo implements UserPointStateRepo {
  async upsert(userId: string, pointId: string, state: UserPointStateValue, opts?: UpsertUserPointStateOpts): Promise<UserPointState> {
    const now = new Date()
    const created = await prisma.userPointState.upsert({
      where: {
        userId_pointId: { userId, pointId },
      },
      create: {
        userId,
        pointId,
        state,
        checkedInAt: opts?.checkedInAt ?? null,
        gpsVerified: opts?.gpsVerified ?? false,
        photoUrl: opts?.photoUrl ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        state,
        checkedInAt: opts?.checkedInAt === undefined ? undefined : opts.checkedInAt,
        gpsVerified: opts?.gpsVerified === undefined ? undefined : opts.gpsVerified,
        photoUrl: opts?.photoUrl === undefined ? undefined : opts.photoUrl,
        updatedAt: now,
      },
    })
    return toUserPointState(created)
  }

  async delete(userId: string, pointId: string): Promise<boolean> {
    try {
      await prisma.userPointState.delete({
        where: {
          userId_pointId: { userId, pointId },
        },
      })
      return true
    } catch (err) {
      if (isPrismaKnownRequestError(err) && err.code === 'P2025') {
        return false
      }
      throw err
    }
  }

  async listByUser(userId: string, filters?: ListByUserFilters): Promise<UserPointState[]> {
    const where: Prisma.UserPointStateWhereInput = {
      userId,
      ...(filters?.state ? { state: filters.state } : {}),
    }

    if (filters?.bangumiId !== undefined) {
      where.point = {
        bangumiId: filters.bangumiId,
      }
    }

    const list = await prisma.userPointState.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })
    return list.map(toUserPointState)
  }

  async getByUserAndPoint(userId: string, pointId: string): Promise<UserPointState | null> {
    const found = await prisma.userPointState.findUnique({
      where: {
        userId_pointId: { userId, pointId },
      },
    })
    return found ? toUserPointState(found) : null
  }

  async countByBangumi(userId: string, bangumiId: number): Promise<number> {
    return await prisma.userPointState.count({
      where: {
        userId,
        point: {
          bangumiId,
        },
      },
    })
  }
}
