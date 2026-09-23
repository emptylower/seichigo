import { Prisma } from '@seichigo/prisma-client-runtime'
import { prisma } from '@/lib/db/prisma'
import { resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import { DAY_COUNT_MAX, RouteBookRuleError, computeDayDate } from './rules'
import type {
  DayContext,
  DayReorderResult,
  ItemCreateInput,
  ItemCreateResult,
  ItemListResult,
  ItemUpdateInput,
  LodgingInput,
  PlaceInput,
  RouteBook,
  RouteBookDetail,
  RouteBookListItem,
  RouteBookPointListFilters,
  RouteBookPointRef,
  RouteBookRepo,
  RouteBookStatus,
  RouteBookUpdateInput,
  RouteBookDay,
  RouteBookItem,
  RouteBookPlace,
  RouteBookLodging,
  TravelMode,
  WriteReceipt,
  WithBookUpdatedAt,
} from './repo'
import { assertStale, toBook, toDay, toItem, toLodging, toPlace } from './repoPrismaShared'
import { insertDayTx, updateDayTx, deleteDayTx, reorderDaysTx } from './repoPrismaDays'
import {
  createItemTx,
  updateItemTx,
  deleteItemTx,
  reorderItemsTx,
  replaceDayOrderTx,
  createPlaceTx,
  updatePlaceTx,
  deletePlaceTx,
  createLodgingTx,
  updateLodgingTx,
  deleteLodgingTx,
} from './repoPrismaItems'
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 }

function toJsonSet(value: RouteBookUpdateInput['metadata']): Prisma.RouteBookUpdateInput['metadata'] {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value
}

export class PrismaRouteBookRepo implements RouteBookRepo {
  private readonly now: () => Date

  constructor(options?: { now?: () => Date }) {
    this.now = options?.now ?? (() => new Date())
  }

  async create(
    userId: string,
    title: string,
    status: RouteBookStatus,
    opts?: { startDate?: Date | null; dayCount?: number }
  ): Promise<RouteBook> {
    const dayCount = opts?.dayCount ?? 1
    if (dayCount < 1 || dayCount > DAY_COUNT_MAX) {
      throw new RouteBookRuleError('invalid', `天数必须在 1 到 ${DAY_COUNT_MAX} 之间`)
    }

    return prisma.$transaction(async (tx) => {
      const created = await tx.routeBook.create({
        data: {
          userId,
          title,
          status,
          startDate: opts?.startDate ?? null,
          dayCount,
        },
      })
      const dayRows = Array.from({ length: dayCount }, (_, index) => ({
        routeBookId: created.id,
        dayIndex: index + 1,
        date: computeDayDate(created.startDate, index + 1),
      }))
      await tx.routeBookDay.createMany({ data: dayRows })
      return toBook(created)
    }, TX_OPTIONS)
  }

  async update(id: string, userId: string, data: RouteBookUpdateInput, expectedUpdatedAt?: Date): Promise<RouteBook | null> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.routeBook.findFirst({ where: { id, userId } })
      if (!existing) return null
      assertStale(existing, expectedUpdatedAt)

      if (data.dayCount !== undefined) {
        if (data.dayCount < existing.dayCount) {
          throw new RouteBookRuleError('invalid', '天数只能增加不能减少')
        }
        if (data.dayCount > DAY_COUNT_MAX) {
          throw new RouteBookRuleError('invalid', `天数最多 ${DAY_COUNT_MAX}`)
        }
      }

      const now = this.now()
      const res = await tx.routeBook.updateMany({
        where: { id, userId, updatedAt: existing.updatedAt },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.metadata !== undefined ? { metadata: toJsonSet(data.metadata) } : {}),
          ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
          ...(data.dayCount !== undefined ? { dayCount: data.dayCount } : {}),
          updatedAt: now,
        },
      })
      if (res.count === 0) throw new RouteBookRuleError('stale', '行程已在别处修改，请刷新')

      const nextDayCount = data.dayCount ?? existing.dayCount
      if (nextDayCount > existing.dayCount) {
        const startDate = data.startDate !== undefined ? data.startDate : existing.startDate
        await tx.routeBookDay.createMany({
          data: Array.from({ length: nextDayCount - existing.dayCount }, (_, offset) => ({
            routeBookId: id,
            dayIndex: existing.dayCount + offset + 1,
            date: computeDayDate(startDate, existing.dayCount + offset + 1),
          })),
        })
      }

      if (data.startDate !== undefined) {
        const days = await tx.routeBookDay.findMany({ where: { routeBookId: id } })
        await Promise.all(
          days.map((day) =>
            tx.routeBookDay.update({
              where: { id: day.id },
              data: { date: computeDayDate(data.startDate ?? null, day.dayIndex) },
            })
          )
        )
      }

      return toBook({ ...existing, ...data, updatedAt: now })
    }, TX_OPTIONS)
  }

  async delete(id: string, userId: string): Promise<RouteBook | null> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.routeBook.findFirst({ where: { id, userId } })
      if (!existing) return null
      await tx.routeBook.delete({ where: { id } })
      return toBook(existing)
    }, TX_OPTIONS)
  }

  async getById(id: string, userId: string): Promise<RouteBookDetail | null> {
    const found = await prisma.routeBook.findFirst({
      where: { id, userId },
      include: {
        days: { orderBy: { dayIndex: 'asc' } },
        items: { orderBy: [{ dayId: { sort: 'asc', nulls: 'last' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
        places: { orderBy: { createdAt: 'asc' } },
        lodgings: { orderBy: { fromDayIndex: 'asc' } },
      },
    })
    if (!found) return null

    return {
      ...toBook(found),
      days: found.days.map(toDay),
      items: found.items.map(toItem),
      places: found.places.map(toPlace),
      lodgings: found.lodgings.map(toLodging),
    }
  }

  /**
   * A1 瘦身：一条 findFirst 拿齐单天上下文（天 + 仅该天条目 + 本级 places/lodgings）。
   * 以 routeBook 为父行、关系全部按 dayId 过滤——关系加载只有一层（实测比嵌套
   * routeBook select 少一个串行批次），且不拉其它天的条目。
   */
  async getDayContext(routeBookId: string, userId: string, dayId: string): Promise<DayContext | null> {
    const found = await prisma.routeBook.findFirst({
      where: { id: routeBookId, userId, days: { some: { id: dayId } } },
      include: {
        days: { where: { id: dayId } },
        items: { where: { dayId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
        places: { orderBy: { createdAt: 'asc' } },
        lodgings: { orderBy: { fromDayIndex: 'asc' } },
      },
    })
    const day = found?.days[0]
    if (!found || !day) return null

    return {
      day: toDay(day),
      items: found.items.map(toItem),
      places: found.places.map(toPlace),
      lodgings: found.lodgings.map(toLodging),
    }
  }

  async listByUser(userId: string, filters?: { status?: RouteBookStatus }): Promise<RouteBookListItem[]> {
    const list = await prisma.routeBook.findMany({
      where: {
        userId,
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        items: {
          where: { kind: 'point' },
          orderBy: [{ day: { dayIndex: 'asc' } }, { sortOrder: 'asc' }],
          take: 1,
          select: { point: { select: { image: true } } },
        },
      },
    })
    return list.map((item) => {
      const rawImage = item.items[0]?.point?.image ?? null
      const firstPointImage = rawImage ? resolveAnitabiAssetUrl(rawImage) : null
      return { ...toBook(item), firstPointImage }
    })
  }

  async insertDay(routeBookId: string, userId: string, afterDayIndex: number): Promise<WithBookUpdatedAt<RouteBookDay>> {
    return prisma.$transaction((tx) => insertDayTx(tx, routeBookId, userId, afterDayIndex, this.now()), TX_OPTIONS)
  }

  async updateDay(
    routeBookId: string,
    userId: string,
    dayId: string,
    data: { title?: string | null; defaultTravelMode?: TravelMode }
  ): Promise<WithBookUpdatedAt<RouteBookDay> | null> {
    return prisma.$transaction((tx) => updateDayTx(tx, routeBookId, userId, dayId, data, this.now()), TX_OPTIONS)
  }

  async deleteDay(routeBookId: string, userId: string, dayId: string): Promise<WriteReceipt | null> {
    return prisma.$transaction((tx) => deleteDayTx(tx, routeBookId, userId, dayId, this.now()), TX_OPTIONS)
  }

  async reorderDays(routeBookId: string, userId: string, orderedDayIds: string[]): Promise<DayReorderResult> {
    return prisma.$transaction((tx) => reorderDaysTx(tx, routeBookId, userId, orderedDayIds, this.now()), TX_OPTIONS)
  }

  async createItem(routeBookId: string, userId: string, input: ItemCreateInput): Promise<ItemCreateResult> {
    return prisma.$transaction((tx) => createItemTx(tx, routeBookId, userId, input, this.now()), TX_OPTIONS)
  }

  async updateItem(
    routeBookId: string,
    userId: string,
    itemId: string,
    data: ItemUpdateInput
  ): Promise<WithBookUpdatedAt<RouteBookItem> | null> {
    return prisma.$transaction((tx) => updateItemTx(tx, routeBookId, userId, itemId, data, this.now()), TX_OPTIONS)
  }

  async deleteItem(routeBookId: string, userId: string, itemId: string): Promise<WriteReceipt | null> {
    return prisma.$transaction((tx) => deleteItemTx(tx, routeBookId, userId, itemId, this.now()), TX_OPTIONS)
  }

  async reorderItems(
    routeBookId: string,
    userId: string,
    dayId: string | null,
    orderedItemIds: string[]
  ): Promise<ItemListResult> {
    return prisma.$transaction((tx) => reorderItemsTx(tx, routeBookId, userId, dayId, orderedItemIds, this.now()), TX_OPTIONS)
  }

  async replaceDayOrder(
    routeBookId: string,
    userId: string,
    dayId: string,
    orderedItemIds: string[]
  ): Promise<ItemListResult> {
    return prisma.$transaction((tx) => replaceDayOrderTx(tx, routeBookId, userId, dayId, orderedItemIds, this.now()), TX_OPTIONS)
  }

  async createPlace(routeBookId: string, userId: string, input: PlaceInput): Promise<WithBookUpdatedAt<RouteBookPlace>> {
    return prisma.$transaction((tx) => createPlaceTx(tx, routeBookId, userId, input, this.now()), TX_OPTIONS)
  }

  async updatePlace(
    routeBookId: string,
    userId: string,
    placeId: string,
    input: Partial<PlaceInput>
  ): Promise<WithBookUpdatedAt<RouteBookPlace> | null> {
    return prisma.$transaction((tx) => updatePlaceTx(tx, routeBookId, userId, placeId, input, this.now()), TX_OPTIONS)
  }

  /** 级联删 items/lodgings */
  async deletePlace(routeBookId: string, userId: string, placeId: string): Promise<WriteReceipt | null> {
    return prisma.$transaction((tx) => deletePlaceTx(tx, routeBookId, userId, placeId, this.now()), TX_OPTIONS)
  }

  async createLodging(routeBookId: string, userId: string, input: LodgingInput): Promise<WithBookUpdatedAt<RouteBookLodging>> {
    return prisma.$transaction((tx) => createLodgingTx(tx, routeBookId, userId, input, this.now()), TX_OPTIONS)
  }

  async updateLodging(
    routeBookId: string,
    userId: string,
    lodgingId: string,
    input: Partial<LodgingInput>
  ): Promise<WithBookUpdatedAt<RouteBookLodging> | null> {
    return prisma.$transaction((tx) => updateLodgingTx(tx, routeBookId, userId, lodgingId, input, this.now()), TX_OPTIONS)
  }

  async deleteLodging(routeBookId: string, userId: string, lodgingId: string): Promise<WriteReceipt | null> {
    return prisma.$transaction((tx) => deleteLodgingTx(tx, routeBookId, userId, lodgingId, this.now()), TX_OPTIONS)
  }

  async isPointInAnyRouteBook(userId: string, pointId: string): Promise<boolean> {
    const found = await prisma.routeBookItem.findFirst({
      where: {
        pointId,
        kind: 'point',
        routeBook: { userId },
      },
      select: { id: true },
    })
    return Boolean(found)
  }

  async listPointRefsByUser(userId: string, filters?: RouteBookPointListFilters): Promise<RouteBookPointRef[]> {
    const rows = await prisma.routeBookItem.findMany({
      where: {
        kind: 'point',
        pointId: { not: null },
        routeBook: {
          userId,
        },
        ...(filters?.bangumiId !== undefined
          ? {
              point: {
                bangumiId: filters.bangumiId,
              },
            }
          : {}),
      },
      select: {
        pointId: true,
        routeBook: {
          select: {
            updatedAt: true,
          },
        },
        createdAt: true,
      },
      orderBy: [{ routeBook: { updatedAt: 'desc' } }, { createdAt: 'desc' }],
    })

    const merged = new Map<string, Date>()
    for (const row of rows) {
      if (!row.pointId) continue
      const seen = merged.get(row.pointId)
      const updatedAt = row.routeBook.updatedAt ?? row.createdAt
      if (!seen || seen.getTime() < updatedAt.getTime()) {
        merged.set(row.pointId, updatedAt)
      }
    }

    return Array.from(merged.entries())
      .map(([pointId, updatedAt]) => ({ pointId, updatedAt }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }
}
