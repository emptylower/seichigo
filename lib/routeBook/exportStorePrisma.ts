import { prisma } from '@/lib/db/prisma'
import type { RouteBookExportCreateInput, RouteBookExportStore } from './exportStore'

const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 }

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

  async createFromPlan(input: RouteBookExportCreateInput): Promise<{ id: string }> {
    return prisma.$transaction(async (tx) => {
      const book = await tx.routeBook.create({
        data: {
          userId: input.userId,
          title: input.title,
          status: input.status,
          metadata: input.metadata,
          startDate: input.startDate,
          dayCount: input.dayCount,
        },
        select: { id: true },
      })

      if (input.days.length > 0) {
        await tx.routeBookDay.createMany({
          data: input.days.map((day) => ({
            routeBookId: book.id,
            dayIndex: day.dayIndex,
            date: day.date,
            title: day.title,
          })),
        })
      }
      const dayRows = await tx.routeBookDay.findMany({
        where: { routeBookId: book.id },
        select: { id: true, dayIndex: true },
      })
      const dayIdByIndex = new Map(dayRows.map((row) => [row.dayIndex, row.id]))

      if (input.places.length > 0) {
        await tx.routeBookPlace.createMany({
          data: input.places.map((place) => ({
            id: place.tempId,
            routeBookId: book.id,
            kind: place.kind,
            title: place.title,
            address: place.address,
            lat: place.lat,
            lng: place.lng,
          })),
        })
      }

      if (input.items.length > 0) {
        await tx.routeBookItem.createMany({
          data: input.items.map((item) => ({
            id: item.id,
            routeBookId: book.id,
            dayId: item.dayIndex != null ? dayIdByIndex.get(item.dayIndex) ?? null : null,
            sortOrder: item.sortOrder,
            kind: item.kind,
            pointId: item.pointId ?? null,
            placeId: item.placeTempId ?? null,
            title: item.title ?? null,
            note: item.note ?? null,
            timeStart: item.timeStart ?? null,
            timeEnd: item.timeEnd ?? null,
            locked: item.locked ?? false,
            payload: item.payload ?? undefined,
          })),
        })
      }

      if (input.lodgings.length > 0) {
        await tx.routeBookLodging.createMany({
          data: input.lodgings.map((lodging) => ({
            routeBookId: book.id,
            placeId: lodging.placeTempId,
            fromDayIndex: lodging.fromDayIndex,
            toDayIndex: lodging.toDayIndex,
          })),
        })
      }

      return book
    }, TX_OPTIONS)
  }
}
