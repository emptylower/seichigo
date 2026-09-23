import type { Prisma, RouteBook as PrismaRouteBook, RouteBookDay as PrismaRouteBookDay, RouteBookItem as PrismaRouteBookItem, RouteBookLodging as PrismaRouteBookLodging, RouteBookPlace as PrismaRouteBookPlace } from '@prisma/client'
import { RouteBookRuleError, normalizeTransitItems } from './rules'
import type { ItemKind, PlaceKind, RouteBook, RouteBookDay, RouteBookItem, RouteBookLodging, RouteBookPlace, RouteBookStatus, TravelMode } from './repo'

export type Tx = Prisma.TransactionClient

export function toBook(record: PrismaRouteBook): RouteBook {
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    status: record.status as RouteBookStatus,
    metadata: record.metadata,
    startDate: record.startDate,
    dayCount: record.dayCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function toDay(record: PrismaRouteBookDay): RouteBookDay {
  return {
    id: record.id,
    routeBookId: record.routeBookId,
    dayIndex: record.dayIndex,
    date: record.date,
    title: record.title,
    defaultTravelMode: record.defaultTravelMode as TravelMode,
  }
}

export function toItem(record: PrismaRouteBookItem): RouteBookItem {
  return {
    id: record.id,
    routeBookId: record.routeBookId,
    dayId: record.dayId,
    sortOrder: record.sortOrder,
    kind: record.kind as ItemKind,
    pointId: record.pointId,
    placeId: record.placeId,
    title: record.title,
    note: record.note,
    timeStart: record.timeStart,
    timeEnd: record.timeEnd,
    locked: record.locked,
    icon: record.icon,
    color: record.color,
    legMode: record.legMode as TravelMode | null,
    payload: record.payload,
    createdAt: record.createdAt,
  }
}

export function toPlace(record: PrismaRouteBookPlace): RouteBookPlace {
  return {
    id: record.id,
    routeBookId: record.routeBookId,
    kind: record.kind as PlaceKind,
    title: record.title,
    address: record.address,
    lat: record.lat,
    lng: record.lng,
    note: record.note,
    createdAt: record.createdAt,
  }
}

export function toLodging(record: PrismaRouteBookLodging): RouteBookLodging {
  return {
    id: record.id,
    routeBookId: record.routeBookId,
    placeId: record.placeId,
    fromDayIndex: record.fromDayIndex,
    toDayIndex: record.toDayIndex,
    checkIn: record.checkIn,
    checkOut: record.checkOut,
    note: record.note,
  }
}

export async function requireBookTx(tx: Tx, routeBookId: string, userId: string): Promise<PrismaRouteBook> {
  const book = await tx.routeBook.findFirst({ where: { id: routeBookId, userId } })
  if (!book) throw new RouteBookRuleError('not_found', '行程不存在')
  return book
}

export function assertStale(book: PrismaRouteBook, expectedUpdatedAt?: Date): void {
  if (expectedUpdatedAt && expectedUpdatedAt.getTime() !== book.updatedAt.getTime()) {
    throw new RouteBookRuleError('stale', '行程已在别处修改，请刷新')
  }
}

/** 乐观锁推进 updatedAt：expected 缺省用事务内读到的当前值，count === 0 → stale */
export async function touchTx(
  tx: Tx,
  routeBookId: string,
  userId: string,
  now: Date,
  data: Prisma.RouteBookUpdateInput = {},
  expected: Date
): Promise<Date> {
  const res = await tx.routeBook.updateMany({
    where: { id: routeBookId, userId, updatedAt: expected },
    data: { ...data, updatedAt: now },
  })
  if (res.count === 0) throw new RouteBookRuleError('stale', '行程已在别处修改，请刷新')
  return now
}

export async function loadDayItemsTx(tx: Tx, routeBookId: string, dayId: string | null): Promise<RouteBookItem[]> {
  const rows = await tx.routeBookItem.findMany({
    where: { routeBookId, dayId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toItem)
}

export async function loadBookItemsTx(tx: Tx, routeBookId: string): Promise<RouteBookItem[]> {
  const rows = await tx.routeBookItem.findMany({
    where: { routeBookId },
    orderBy: [{ dayId: { sort: 'asc', nulls: 'last' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toItem)
}

/** 天（或未安排区）内重编 sortOrder 并执行 transit 附着规则 */
export async function rewriteDayOrderTx(tx: Tx, routeBookId: string, dayId: string | null): Promise<void> {
  const group = await loadDayItemsTx(tx, routeBookId, dayId)
  const normalized = normalizeTransitItems(group)
  if (normalized.deletedTransitItemIds.length > 0) {
    await tx.routeBookItem.deleteMany({ where: { id: { in: normalized.deletedTransitItemIds }, routeBookId } })
  }
  const previousOrder = new Map(group.map((item) => [item.id, item.sortOrder]))
  await Promise.all(
    normalized.items.map((item, index) =>
      previousOrder.get(item.id) === index
        ? Promise.resolve(null)
        : tx.routeBookItem.update({ where: { id: item.id }, data: { sortOrder: index } })
    )
  )
}
