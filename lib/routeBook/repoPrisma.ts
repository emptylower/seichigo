import { Prisma, type RouteBook as PrismaRouteBook, type RouteBookPoint as PrismaRouteBookPoint } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  SORTED_ZONE_LIMIT,
  SortedZoneLimitError,
  type RouteBook,
  type RouteBookPoint,
  type RouteBookRepo,
  type RouteBookStatus,
  type RouteBookUpdateInput,
  type RouteBookWithPoints,
  type RouteBookZone,
} from './repo'

function toRouteBook(record: PrismaRouteBook): RouteBook {
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    status: record.status as RouteBookStatus,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toRouteBookPoint(record: PrismaRouteBookPoint): RouteBookPoint {
  return {
    id: record.id,
    routeBookId: record.routeBookId,
    pointId: record.pointId,
    sortOrder: record.sortOrder,
    zone: record.zone as RouteBookZone,
    createdAt: record.createdAt,
  }
}

function toJsonSet(value: RouteBookUpdateInput['metadata']) {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value
}

async function compactZoneOrders(tx: Prisma.TransactionClient, routeBookId: string): Promise<void> {
  const points = await tx.routeBookPoint.findMany({
    where: { routeBookId },
    orderBy: [{ zone: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  const byZone: Record<RouteBookZone, PrismaRouteBookPoint[]> = {
    sorted: [],
    unsorted: [],
  }

  for (const p of points) {
    const zone = p.zone as RouteBookZone
    if (zone !== 'sorted' && zone !== 'unsorted') continue
    byZone[zone].push(p)
  }

  const updates: Promise<unknown>[] = []
  for (const zone of ['sorted', 'unsorted'] as const) {
    for (let i = 0; i < byZone[zone].length; i++) {
      const p = byZone[zone][i]
      if (p.sortOrder === i) continue
      updates.push(tx.routeBookPoint.update({ where: { id: p.id }, data: { sortOrder: i } }))
    }
  }
  await Promise.all(updates)
}

export class PrismaRouteBookRepo implements RouteBookRepo {
  async create(userId: string, title: string, status: RouteBookStatus): Promise<RouteBook> {
    try {
      const created = await prisma.routeBook.create({
        data: {
          userId,
          title,
          status,
        },
      })
      return toRouteBook(created)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw err
      }
      throw err
    }
  }

  async update(id: string, userId: string, data: RouteBookUpdateInput): Promise<RouteBook | null> {
    try {
      const existing = await prisma.routeBook.findFirst({ where: { id, userId } })
      if (!existing) return null

      const updated = await prisma.routeBook.update({
        where: { id },
        data: {
          title: data.title ?? undefined,
          status: data.status ?? undefined,
          metadata: toJsonSet(data.metadata),
        },
      })
      return toRouteBook(updated)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return null
      }
      throw err
    }
  }

  async delete(id: string, userId: string): Promise<RouteBook | null> {
    try {
      const existing = await prisma.routeBook.findFirst({ where: { id, userId } })
      if (!existing) return null

      const deleted = await prisma.routeBook.delete({ where: { id } })
      return toRouteBook(deleted)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return null
      }
      throw err
    }
  }

  async getById(id: string, userId: string): Promise<RouteBookWithPoints | null> {
    const found = await prisma.routeBook.findFirst({
      where: { id, userId },
      include: {
        points: {
          orderBy: [{ zone: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    })
    if (!found) return null

    return {
      ...toRouteBook(found),
      points: found.points.map(toRouteBookPoint),
    }
  }

  async listByUser(userId: string, filters?: { status?: RouteBookStatus }): Promise<RouteBook[]> {
    const list = await prisma.routeBook.findMany({
      where: {
        userId,
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    })
    return list.map(toRouteBook)
  }

  async addPoint(routeBookId: string, userId: string, pointId: string, zone: RouteBookZone): Promise<RouteBookPoint> {
    return prisma.$transaction(async (tx) => {
      const routeBook = await tx.routeBook.findFirst({ where: { id: routeBookId, userId }, select: { id: true } })
      if (!routeBook) throw new Error('RouteBook not found')

      const existing = await tx.routeBookPoint.findFirst({
        where: {
          routeBookId,
          pointId,
          routeBook: { userId },
        },
      })
      if (existing) return toRouteBookPoint(existing)

      if (zone === 'sorted') {
        const sortedCount = await tx.routeBookPoint.count({ where: { routeBookId, zone: 'sorted' } })
        if (sortedCount >= SORTED_ZONE_LIMIT) throw new SortedZoneLimitError(routeBookId)
      }

      const max = await tx.routeBookPoint.aggregate({
        where: { routeBookId, zone },
        _max: { sortOrder: true },
      })
      const nextSortOrder = (max._max.sortOrder ?? -1) + 1

      const created = await tx.routeBookPoint.create({
        data: {
          routeBookId,
          pointId,
          zone,
          sortOrder: nextSortOrder,
        },
      })

      if (zone === 'sorted') {
        await compactZoneOrders(tx, routeBookId)
      }

      return toRouteBookPoint(created)
    })
  }

  async removePoint(routeBookId: string, userId: string, pointId: string): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const routeBook = await tx.routeBook.findFirst({ where: { id: routeBookId, userId }, select: { id: true } })
      if (!routeBook) throw new Error('RouteBook not found')

      const deleted = await tx.routeBookPoint.deleteMany({
        where: {
          routeBookId,
          pointId,
          routeBook: { userId },
        },
      })

      if (deleted.count > 0) {
        await compactZoneOrders(tx, routeBookId)
      }

      return deleted.count > 0
    })
  }

  async reorderPoints(routeBookId: string, userId: string, pointIds: string[]): Promise<RouteBookPoint[]> {
    return prisma.$transaction(async (tx) => {
      const routeBook = await tx.routeBook.findFirst({ where: { id: routeBookId, userId }, select: { id: true } })
      if (!routeBook) throw new Error('RouteBook not found')

      const existing = await tx.routeBookPoint.findMany({
        where: { routeBookId, zone: 'sorted', routeBook: { userId } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })

      const existingIds = new Set(existing.map((p) => p.pointId))
      const seen = new Set<string>()
      const head: string[] = []
      for (const id of pointIds) {
        if (!existingIds.has(id)) continue
        if (seen.has(id)) continue
        seen.add(id)
        head.push(id)
      }
      const tail = existing
        .map((p) => p.pointId)
        .filter((id) => !seen.has(id))

      const next = [...head, ...tail]
      if (next.length > SORTED_ZONE_LIMIT) throw new SortedZoneLimitError(routeBookId)

      const updates: Promise<unknown>[] = []
      for (let i = 0; i < next.length; i++) {
        const id = next[i]
        const record = existing.find((p) => p.pointId === id)
        if (!record) continue
        if (record.sortOrder === i) continue
        updates.push(tx.routeBookPoint.update({ where: { id: record.id }, data: { sortOrder: i } }))
      }
      await Promise.all(updates)

      await compactZoneOrders(tx, routeBookId)

      const out = await tx.routeBookPoint.findMany({
        where: { routeBookId, zone: 'sorted', routeBook: { userId } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })
      return out.map(toRouteBookPoint)
    })
  }

  async movePointToZone(routeBookId: string, userId: string, pointId: string, zone: RouteBookZone): Promise<RouteBookPoint | null> {
    return prisma.$transaction(async (tx) => {
      const routeBook = await tx.routeBook.findFirst({ where: { id: routeBookId, userId }, select: { id: true } })
      if (!routeBook) throw new Error('RouteBook not found')

      const existing = await tx.routeBookPoint.findFirst({
        where: { routeBookId, pointId, routeBook: { userId } },
      })
      if (!existing) return null

      const currentZone = existing.zone as RouteBookZone
      if (currentZone === zone) return toRouteBookPoint(existing)

      if (zone === 'sorted') {
        const sortedCount = await tx.routeBookPoint.count({
          where: { routeBookId, zone: 'sorted' },
        })
        if (sortedCount >= SORTED_ZONE_LIMIT) throw new SortedZoneLimitError(routeBookId)
      }

      const max = await tx.routeBookPoint.aggregate({
        where: { routeBookId, zone },
        _max: { sortOrder: true },
      })
      const nextSortOrder = (max._max.sortOrder ?? -1) + 1

      const updated = await tx.routeBookPoint.update({
        where: { id: existing.id },
        data: { zone, sortOrder: nextSortOrder },
      })

      await compactZoneOrders(tx, routeBookId)

      const reloaded = await tx.routeBookPoint.findUnique({ where: { id: updated.id } })
      return reloaded ? toRouteBookPoint(reloaded) : toRouteBookPoint(updated)
    })
  }
}
