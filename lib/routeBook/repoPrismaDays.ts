import { RouteBookRuleError, computeDayDate, shiftLodgingForDelete, shiftLodgingForInsert } from './rules'
import type { DayReorderResult, RouteBookDay, TravelMode, WriteReceipt, WithBookUpdatedAt } from './repo'
import { lockBookTx, toDay, touchTx, type Tx } from './repoPrismaShared'

export async function insertDayTx(tx: Tx, routeBookId: string, userId: string, afterDayIndex: number, now: Date): Promise<WithBookUpdatedAt<RouteBookDay>> {
  const book = await lockBookTx(tx, routeBookId, userId, now)
  if (afterDayIndex < 0 || afterDayIndex > book.dayCount) {
    throw new RouteBookRuleError('invalid', '插入位置无效')
  }
  if (book.dayCount + 1 > 30) {
    throw new RouteBookRuleError('invalid', '天数最多 30')
  }

  const days = await tx.routeBookDay.findMany({ where: { routeBookId }, orderBy: { dayIndex: 'asc' } })
  // 从高到低 +1，避免 (routeBookId, dayIndex) 唯一约束中途冲突
  for (const day of [...days].reverse()) {
    if (day.dayIndex > afterDayIndex) {
      await tx.routeBookDay.update({
        where: { id: day.id },
        data: { dayIndex: day.dayIndex + 1, date: computeDayDate(book.startDate, day.dayIndex + 1) },
      })
    }
  }

  const lodgings = await tx.routeBookLodging.findMany({ where: { routeBookId } })
  for (const lodging of lodgings) {
    const shifted = shiftLodgingForInsert(lodging, afterDayIndex)
    if (shifted.fromDayIndex !== lodging.fromDayIndex || shifted.toDayIndex !== lodging.toDayIndex) {
      await tx.routeBookLodging.update({
        where: { id: lodging.id },
        data: { fromDayIndex: shifted.fromDayIndex, toDayIndex: shifted.toDayIndex },
      })
    }
  }

  const created = await tx.routeBookDay.create({
    data: {
      routeBookId,
      dayIndex: afterDayIndex + 1,
      date: computeDayDate(book.startDate, afterDayIndex + 1),
    },
  })
  await touchTx(tx, routeBookId, userId, now, { dayCount: book.dayCount + 1 })
  return { ...toDay(created), bookUpdatedAt: now }
}

export async function updateDayTx(
  tx: Tx,
  routeBookId: string,
  userId: string,
  dayId: string,
  data: { title?: string | null; defaultTravelMode?: TravelMode },
  now: Date
): Promise<WithBookUpdatedAt<RouteBookDay> | null> {
  await lockBookTx(tx, routeBookId, userId, now)
  const existing = await tx.routeBookDay.findFirst({ where: { id: dayId, routeBookId } })
  if (!existing) return null

  const updated = await tx.routeBookDay.update({
    where: { id: dayId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.defaultTravelMode !== undefined ? { defaultTravelMode: data.defaultTravelMode } : {}),
    },
  })
  return { ...toDay(updated), bookUpdatedAt: now }
}

export async function deleteDayTx(tx: Tx, routeBookId: string, userId: string, dayId: string, now: Date): Promise<WriteReceipt | null> {
  const book = await lockBookTx(tx, routeBookId, userId, now)
  const day = await tx.routeBookDay.findFirst({ where: { id: dayId, routeBookId } })
  if (!day) return null

  if (book.dayCount <= 1) {
    throw new RouteBookRuleError('invalid', '至少要保留一天')
  }
  const itemCount = await tx.routeBookItem.count({ where: { routeBookId, dayId } })
  if (itemCount > 0) {
    throw new RouteBookRuleError('day_not_empty', '先清空这一天再删除')
  }

  const delIndex = day.dayIndex
  await tx.routeBookDay.delete({ where: { id: dayId } })
  // 从低到高 -1，避免唯一约束中途冲突
  const remaining = await tx.routeBookDay.findMany({ where: { routeBookId }, orderBy: { dayIndex: 'asc' } })
  for (const other of remaining) {
    if (other.dayIndex > delIndex) {
      await tx.routeBookDay.update({
        where: { id: other.id },
        data: { dayIndex: other.dayIndex - 1, date: computeDayDate(book.startDate, other.dayIndex - 1) },
      })
    }
  }

  const lodgings = await tx.routeBookLodging.findMany({ where: { routeBookId } })
  for (const lodging of lodgings) {
    const shifted = shiftLodgingForDelete(lodging, delIndex)
    if (!shifted) {
      await tx.routeBookLodging.delete({ where: { id: lodging.id } })
    } else if (shifted.fromDayIndex !== lodging.fromDayIndex || shifted.toDayIndex !== lodging.toDayIndex) {
      await tx.routeBookLodging.update({
        where: { id: lodging.id },
        data: { fromDayIndex: shifted.fromDayIndex, toDayIndex: shifted.toDayIndex },
      })
    }
  }

  await touchTx(tx, routeBookId, userId, now, { dayCount: book.dayCount - 1 })
  return { bookUpdatedAt: now }
}

export async function reorderDaysTx(tx: Tx, routeBookId: string, userId: string, orderedDayIds: string[], now: Date): Promise<DayReorderResult> {
  const book = await lockBookTx(tx, routeBookId, userId, now)
  const days = await tx.routeBookDay.findMany({ where: { routeBookId } })
  const currentIds = new Set(days.map((day) => day.id))
  const orderedSet = new Set(orderedDayIds)
  if (orderedDayIds.length !== currentIds.size || orderedDayIds.some((id) => !currentIds.has(id)) || orderedSet.size !== orderedDayIds.length) {
    throw new RouteBookRuleError('invalid', '列表与当前天数不一致，请刷新')
  }

  // 两阶段重编：先挪到负数临时下标，绕开唯一约束
  for (let i = 0; i < days.length; i++) {
    await tx.routeBookDay.update({ where: { id: days[i].id }, data: { dayIndex: -(i + 1) } })
  }
  await Promise.all(
    orderedDayIds.map((id, index) =>
      tx.routeBookDay.update({ where: { id }, data: { dayIndex: index + 1, date: computeDayDate(book.startDate, index + 1) } })
    )
  )

  const out = await tx.routeBookDay.findMany({ where: { routeBookId }, orderBy: { dayIndex: 'asc' } })
  return { days: out.map(toDay), bookUpdatedAt: now }
}
