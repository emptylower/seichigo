import { DAY_COUNT_MAX, PLACE_LIMIT, RouteBookRuleError, assertAnchorOrder, assertDayLimit, assertLodgingNoOverlap } from './rules'
import type {
  ItemCreateInput,
  ItemCreateResult,
  ItemListResult,
  ItemUpdateInput,
  LodgingInput,
  PlaceInput,
  RouteBookItem,
  RouteBookLodging,
  RouteBookPlace,
  WriteReceipt,
  WithBookUpdatedAt,
} from './repo'
import { loadBookItemsTx, loadDayItemsTx, lockBookTx, rewriteDayOrderTx, toLodging, toPlace, toItem, touchTx, type Tx } from './repoPrismaShared'

function countVisitable(items: Pick<RouteBookItem, 'kind'>[]): number {
  return items.filter((item) => item.kind === 'point' || item.kind === 'place').length
}

async function requireDayTx(tx: Tx, routeBookId: string, dayId: string): Promise<void> {
  const day = await tx.routeBookDay.findFirst({ where: { id: dayId, routeBookId } })
  if (!day) throw new RouteBookRuleError('invalid', '目标天不存在')
}

async function assertItemShapeTx(tx: Tx, routeBookId: string, input: ItemCreateInput): Promise<void> {
  if (input.kind === 'point') {
    if (!input.pointId) throw new RouteBookRuleError('invalid', '点位条目缺少 pointId')
    const point = await tx.anitabiPoint.findUnique({ where: { id: input.pointId }, select: { id: true } })
    if (!point) throw new RouteBookRuleError('invalid', '点位不存在')
  }
  if (input.kind === 'place') {
    if (!input.placeId) throw new RouteBookRuleError('invalid', '自定义点条目缺少 placeId')
    const place = await tx.routeBookPlace.findFirst({ where: { id: input.placeId, routeBookId } })
    if (!place) throw new RouteBookRuleError('invalid', '自定义点不存在')
  }
  if ((input.kind === 'note' || input.kind === 'transit') && !input.title) {
    throw new RouteBookRuleError('invalid', '标题不能为空')
  }
}

export async function createItemTx(
  tx: Tx,
  routeBookId: string,
  userId: string,
  input: ItemCreateInput,
  now: Date
): Promise<ItemCreateResult> {
  await lockBookTx(tx, routeBookId, userId, now)

  if (input.dayId !== null) {
    await requireDayTx(tx, routeBookId, input.dayId)
  }

  await assertItemShapeTx(tx, routeBookId, input)

  if (input.kind === 'point' && input.pointId) {
    const existing = await tx.routeBookItem.findFirst({
      where: { routeBookId, dayId: input.dayId, kind: 'point', pointId: input.pointId },
    })
    if (existing) {
      return { item: toItem(existing), items: await loadDayItemsTx(tx, routeBookId, input.dayId), bookUpdatedAt: now }
    }
  }

  const group = await loadDayItemsTx(tx, routeBookId, input.dayId)
  if (input.dayId !== null && (input.kind === 'point' || input.kind === 'place')) {
    assertDayLimit(countVisitable(group) + 1)
  }

  const insertAt = Math.min(Math.max(input.index ?? group.length, 0), group.length)
  await tx.routeBookItem.updateMany({
    where: { routeBookId, dayId: input.dayId, sortOrder: { gte: insertAt } },
    data: { sortOrder: { increment: 1 } },
  })
  const created = await tx.routeBookItem.create({
    data: {
      routeBookId,
      dayId: input.dayId,
      sortOrder: insertAt,
      kind: input.kind,
      pointId: input.pointId ?? null,
      placeId: input.placeId ?? null,
      title: input.title ?? null,
      note: input.note ?? null,
      timeStart: input.timeStart ?? null,
      payload: input.payload ?? undefined,
    },
  })

  await rewriteDayOrderTx(tx, routeBookId, input.dayId)
  const items = await loadDayItemsTx(tx, routeBookId, input.dayId)
  const item = items.find((row) => row.id === created.id) ?? toItem(created)
  return { item, items, bookUpdatedAt: now }
}

export async function updateItemTx(
  tx: Tx,
  routeBookId: string,
  userId: string,
  itemId: string,
  data: ItemUpdateInput,
  now: Date
): Promise<WithBookUpdatedAt<RouteBookItem> | null> {
  await lockBookTx(tx, routeBookId, userId, now)
  const existing = await tx.routeBookItem.findFirst({ where: { id: itemId, routeBookId } })
  if (!existing) return null

  const updated = await tx.routeBookItem.update({
    where: { id: itemId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
      ...(data.timeStart !== undefined ? { timeStart: data.timeStart } : {}),
      ...(data.timeEnd !== undefined ? { timeEnd: data.timeEnd } : {}),
      ...(data.locked !== undefined ? { locked: data.locked } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.legMode !== undefined ? { legMode: data.legMode } : {}),
    },
  })

  if (data.timeStart !== undefined || data.locked !== undefined) {
    const dayItems = await loadDayItemsTx(tx, routeBookId, updated.dayId)
    assertAnchorOrder(dayItems)
  }

  return { ...toItem(updated), bookUpdatedAt: now }
}

export async function deleteItemTx(tx: Tx, routeBookId: string, userId: string, itemId: string, now: Date): Promise<WriteReceipt | null> {
  await lockBookTx(tx, routeBookId, userId, now)
  const existing = await tx.routeBookItem.findFirst({ where: { id: itemId, routeBookId } })
  if (!existing) return null

  await tx.routeBookItem.delete({ where: { id: itemId } })
  await rewriteDayOrderTx(tx, routeBookId, existing.dayId)
  return { bookUpdatedAt: now }
}

export async function reorderItemsTx(
  tx: Tx,
  routeBookId: string,
  userId: string,
  dayId: string | null,
  orderedItemIds: string[],
  now: Date
): Promise<ItemListResult> {
  await lockBookTx(tx, routeBookId, userId, now)

  if (dayId !== null) {
    await requireDayTx(tx, routeBookId, dayId)
  }

  const bookItems = await loadBookItemsTx(tx, routeBookId)
  const byId = new Map(bookItems.map((item) => [item.id, item]))
  const orderedSet = new Set(orderedItemIds)
  if (orderedSet.size !== orderedItemIds.length) {
    throw new RouteBookRuleError('invalid', '列表中有重复条目')
  }

  const targetItems = bookItems.filter((item) => item.dayId === dayId)
  const targetIds = new Set(targetItems.map((item) => item.id))

  for (const id of orderedItemIds) {
    if (!byId.has(id)) throw new RouteBookRuleError('invalid', '条目不存在')
  }
  for (const item of targetItems) {
    if (!orderedSet.has(item.id)) {
      throw new RouteBookRuleError('invalid', '列表与当前条目不一致，请刷新')
    }
  }

  const movedIn = orderedItemIds
    .map((id) => byId.get(id))
    .filter((item): item is RouteBookItem => item !== undefined && !targetIds.has(item.id))
  if (movedIn.length > 0 && dayId !== null) {
    assertDayLimit(countVisitable(targetItems) + countVisitable(movedIn))
  }

  const affectedSourceDays = new Set(movedIn.map((item) => item.dayId))
  for (let index = 0; index < orderedItemIds.length; index++) {
    const orderedId = orderedItemIds[index]
    if (!orderedId) continue
    const previous = byId.get(orderedId)
    if (!previous || (previous.dayId === dayId && previous.sortOrder === index)) continue
    await tx.routeBookItem.update({
      where: { id: orderedId },
      data: { dayId, sortOrder: index },
    })
  }

  await rewriteDayOrderTx(tx, routeBookId, dayId)
  for (const sourceDayId of affectedSourceDays) {
    await rewriteDayOrderTx(tx, routeBookId, sourceDayId)
  }

  assertAnchorOrder(await loadDayItemsTx(tx, routeBookId, dayId))

  const items = await loadBookItemsTx(tx, routeBookId)
  return { items, bookUpdatedAt: now }
}

export async function replaceDayOrderTx(
  tx: Tx,
  routeBookId: string,
  userId: string,
  dayId: string,
  orderedItemIds: string[],
  now: Date
): Promise<ItemListResult> {
  await lockBookTx(tx, routeBookId, userId, now)
  const dayItems = await loadDayItemsTx(tx, routeBookId, dayId)
  const dayIds = new Set(dayItems.map((item) => item.id))
  const orderedSet = new Set(orderedItemIds)
  if (orderedSet.size !== orderedItemIds.length || orderedItemIds.length !== dayIds.size || orderedItemIds.some((id) => !dayIds.has(id))) {
    throw new RouteBookRuleError('invalid', '列表与当前条目不一致，请刷新')
  }

  const previousById = new Map(dayItems.map((item) => [item.id, item]))
  for (let index = 0; index < orderedItemIds.length; index++) {
    const orderedId = orderedItemIds[index]
    if (!orderedId) continue
    const previous = previousById.get(orderedId)
    if (!previous || previous.sortOrder === index) continue
    await tx.routeBookItem.update({
      where: { id: orderedId },
      data: { sortOrder: index },
    })
  }
  await rewriteDayOrderTx(tx, routeBookId, dayId)

  const items = await loadBookItemsTx(tx, routeBookId)
  return { items, bookUpdatedAt: now }
}

export async function createPlaceTx(tx: Tx, routeBookId: string, userId: string, input: PlaceInput, now: Date): Promise<WithBookUpdatedAt<RouteBookPlace>> {
  await lockBookTx(tx, routeBookId, userId, now)
  const count = await tx.routeBookPlace.count({ where: { routeBookId } })
  if (count >= PLACE_LIMIT) {
    throw new RouteBookRuleError('place_limit', `自定义点最多 ${PLACE_LIMIT} 个`)
  }

  const created = await tx.routeBookPlace.create({
    data: {
      routeBookId,
      kind: input.kind,
      title: input.title,
      address: input.address ?? null,
      lat: input.lat,
      lng: input.lng,
      note: input.note ?? null,
    },
  })
  return { ...toPlace(created), bookUpdatedAt: now }
}

export async function updatePlaceTx(
  tx: Tx,
  routeBookId: string,
  userId: string,
  placeId: string,
  input: Partial<PlaceInput>,
  now: Date
): Promise<WithBookUpdatedAt<RouteBookPlace> | null> {
  await lockBookTx(tx, routeBookId, userId, now)
  const existing = await tx.routeBookPlace.findFirst({ where: { id: placeId, routeBookId } })
  if (!existing) return null

  const updated = await tx.routeBookPlace.update({
    where: { id: placeId },
    data: {
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  })
  return { ...toPlace(updated), bookUpdatedAt: now }
}

export async function deletePlaceTx(tx: Tx, routeBookId: string, userId: string, placeId: string, now: Date): Promise<WriteReceipt | null> {
  await lockBookTx(tx, routeBookId, userId, now)
  const existing = await tx.routeBookPlace.findFirst({ where: { id: placeId, routeBookId } })
  if (!existing) return null

  const affectedItems = await tx.routeBookItem.findMany({
    where: { routeBookId, placeId },
    select: { dayId: true },
  })
  await tx.routeBookLodging.deleteMany({ where: { routeBookId, placeId } })
  await tx.routeBookItem.deleteMany({ where: { routeBookId, placeId } })
  await tx.routeBookPlace.delete({ where: { id: placeId } })

  const affectedDays = new Set(affectedItems.map((item) => item.dayId))
  for (const dayId of affectedDays) {
    await rewriteDayOrderTx(tx, routeBookId, dayId)
  }
  return { bookUpdatedAt: now }
}

async function assertLodgingShapeTx(tx: Tx, routeBookId: string, input: Partial<LodgingInput> & { placeId?: string }): Promise<void> {
  const placeId = input.placeId
  if (!placeId) throw new RouteBookRuleError('invalid', '住宿缺少 placeId')
  const place = await tx.routeBookPlace.findFirst({ where: { id: placeId, routeBookId } })
  if (!place || place.kind !== 'lodging') {
    throw new RouteBookRuleError('invalid', '住宿地点必须是本行程本的酒店自定义点')
  }
  const from = input.fromDayIndex
  const to = input.toDayIndex
  if (from === undefined || to === undefined || from < 1 || to < from) {
    throw new RouteBookRuleError('invalid', '退房日不能早于入住日')
  }
  if (to > DAY_COUNT_MAX) {
    throw new RouteBookRuleError('invalid', `退房日不能超过第 ${DAY_COUNT_MAX} 天`)
  }
}

export async function createLodgingTx(tx: Tx, routeBookId: string, userId: string, input: LodgingInput, now: Date): Promise<WithBookUpdatedAt<RouteBookLodging>> {
  await lockBookTx(tx, routeBookId, userId, now)
  await assertLodgingShapeTx(tx, routeBookId, input)

  const created = await tx.routeBookLodging.create({
    data: {
      routeBookId,
      placeId: input.placeId,
      fromDayIndex: input.fromDayIndex,
      toDayIndex: input.toDayIndex,
      checkIn: input.checkIn ?? null,
      checkOut: input.checkOut ?? null,
      note: input.note ?? null,
    },
  })
  const existing = await tx.routeBookLodging.findMany({ where: { routeBookId } })
  assertLodgingNoOverlap(
    existing.filter((row) => row.id !== created.id).map(toLodging),
    toLodging(created)
  )

  return { ...toLodging(created), bookUpdatedAt: now }
}

export async function updateLodgingTx(
  tx: Tx,
  routeBookId: string,
  userId: string,
  lodgingId: string,
  input: Partial<LodgingInput>,
  now: Date
): Promise<WithBookUpdatedAt<RouteBookLodging> | null> {
  await lockBookTx(tx, routeBookId, userId, now)
  const existing = await tx.routeBookLodging.findFirst({ where: { id: lodgingId, routeBookId } })
  if (!existing) return null

  const candidate = toLodging({
    ...existing,
    ...(input.placeId !== undefined ? { placeId: input.placeId } : {}),
    ...(input.fromDayIndex !== undefined ? { fromDayIndex: input.fromDayIndex } : {}),
    ...(input.toDayIndex !== undefined ? { toDayIndex: input.toDayIndex } : {}),
    ...(input.checkIn !== undefined ? { checkIn: input.checkIn } : {}),
    ...(input.checkOut !== undefined ? { checkOut: input.checkOut } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  })
  await assertLodgingShapeTx(tx, routeBookId, candidate)
  const others = await tx.routeBookLodging.findMany({ where: { routeBookId } })
  assertLodgingNoOverlap(
    others.filter((row) => row.id !== lodgingId).map(toLodging),
    candidate
  )

  const updated = await tx.routeBookLodging.update({
    where: { id: lodgingId },
    data: {
      placeId: candidate.placeId,
      fromDayIndex: candidate.fromDayIndex,
      toDayIndex: candidate.toDayIndex,
      checkIn: candidate.checkIn,
      checkOut: candidate.checkOut,
      note: candidate.note,
    },
  })
  return { ...toLodging(updated), bookUpdatedAt: now }
}

export async function deleteLodgingTx(tx: Tx, routeBookId: string, userId: string, lodgingId: string, now: Date): Promise<WriteReceipt | null> {
  await lockBookTx(tx, routeBookId, userId, now)
  const existing = await tx.routeBookLodging.findFirst({ where: { id: lodgingId, routeBookId } })
  if (!existing) return null

  await tx.routeBookLodging.delete({ where: { id: lodgingId } })
  return { bookUpdatedAt: now }
}
