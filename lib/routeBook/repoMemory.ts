import crypto from 'node:crypto'
import {
  DAY_COUNT_MAX,
  PLACE_LIMIT,
  RouteBookRuleError,
  assertAnchorOrder,
  assertDayLimit,
  assertLodgingNoOverlap,
  computeDayDate,
  normalizeTransitItems,
  shiftLodgingForDelete,
  shiftLodgingForInsert,
} from './rules'
import type {
  DayReorderResult,
  ItemCreateInput,
  ItemCreateResult,
  ItemKind,
  ItemListResult,
  ItemUpdateInput,
  LodgingInput,
  PlaceInput,
  RouteBook,
  RouteBookDay,
  RouteBookDetail,
  RouteBookItem,
  RouteBookListItem,
  RouteBookLodging,
  RouteBookPlace,
  RouteBookPointListFilters,
  RouteBookPointRef,
  RouteBookRepo,
  RouteBookStatus,
  RouteBookUpdateInput,
  TravelMode,
  WriteReceipt,
  WithBookUpdatedAt,
} from './repo'

type Options = {
  now?: () => Date
  idFactory?: () => string
  pointBangumiMap?: Map<string, number>
}

export class InMemoryRouteBookRepo implements RouteBookRepo {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly pointBangumiMap: Map<string, number>

  private readonly byId = new Map<string, RouteBook>()
  private readonly daysById = new Map<string, RouteBookDay>()
  private readonly itemsById = new Map<string, RouteBookItem>()
  private readonly placesById = new Map<string, RouteBookPlace>()
  private readonly lodgingsById = new Map<string, RouteBookLodging>()

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
    this.pointBangumiMap = options?.pointBangumiMap ?? new Map()
  }

  private requireBook(routeBookId: string, userId: string): RouteBook {
    const book = this.byId.get(routeBookId)
    if (!book || book.userId !== userId) throw new RouteBookRuleError('not_found', '行程不存在')
    return book
  }

  private bookDays(routeBookId: string): RouteBookDay[] {
    return Array.from(this.daysById.values())
      .filter((day) => day.routeBookId === routeBookId)
      .sort((a, b) => a.dayIndex - b.dayIndex)
  }

  private dayIndexOf(routeBookId: string, dayId: string | null): number {
    if (dayId === null) return Number.MAX_SAFE_INTEGER
    return this.daysById.get(dayId)?.dayIndex ?? Number.MAX_SAFE_INTEGER
  }

  private listBookItems(routeBookId: string): RouteBookItem[] {
    return Array.from(this.itemsById.values())
      .filter((item) => item.routeBookId === routeBookId)
      .sort((a, b) => {
        const dayA = this.dayIndexOf(routeBookId, a.dayId)
        const dayB = this.dayIndexOf(routeBookId, b.dayId)
        if (dayA !== dayB) return dayA - dayB
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
        if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime()
        return a.id.localeCompare(b.id)
      })
  }

  private dayItems(routeBookId: string, dayId: string | null): RouteBookItem[] {
    return this.listBookItems(routeBookId).filter((item) => item.dayId === dayId)
  }

  private touch(book: RouteBook): Date {
    book.updatedAt = this.now()
    return book.updatedAt
  }

  /** 天（或未安排区）内重编 sortOrder 并执行 transit 附着规则 */
  private rewriteDayOrder(routeBookId: string, dayId: string | null): void {
    const group = this.dayItems(routeBookId, dayId)
    const normalized = normalizeTransitItems(group)
    for (const id of normalized.deletedTransitItemIds) this.itemsById.delete(id)
    normalized.items.forEach((item, index) => {
      this.itemsById.set(item.id, item.sortOrder === index ? item : { ...item, sortOrder: index })
    })
  }

  private createDays(book: RouteBook, fromIndex: number, toIndex: number): void {
    for (let dayIndex = fromIndex; dayIndex <= toIndex; dayIndex++) {
      const day: RouteBookDay = {
        id: this.idFactory(),
        routeBookId: book.id,
        dayIndex,
        date: computeDayDate(book.startDate, dayIndex),
        title: null,
        defaultTravelMode: 'transit',
      }
      this.daysById.set(day.id, day)
    }
  }

  private recomputeDayDates(book: RouteBook): void {
    for (const day of this.bookDays(book.id)) {
      day.date = computeDayDate(book.startDate, day.dayIndex)
    }
  }

  private assertStale(book: RouteBook, expectedUpdatedAt?: Date): void {
    if (expectedUpdatedAt && expectedUpdatedAt.getTime() !== book.updatedAt.getTime()) {
      throw new RouteBookRuleError('stale', '行程已在别处修改，请刷新')
    }
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
    const now = this.now()
    const book: RouteBook = {
      id: this.idFactory(),
      userId,
      title,
      status,
      metadata: null,
      startDate: opts?.startDate ?? null,
      dayCount,
      createdAt: now,
      updatedAt: now,
    }
    this.byId.set(book.id, book)
    this.createDays(book, 1, dayCount)
    return book
  }

  async update(id: string, userId: string, data: RouteBookUpdateInput, expectedUpdatedAt?: Date): Promise<RouteBook | null> {
    const book = this.byId.get(id)
    if (!book || book.userId !== userId) return null
    this.assertStale(book, expectedUpdatedAt)

    if (data.dayCount !== undefined) {
      if (data.dayCount < book.dayCount) {
        throw new RouteBookRuleError('invalid', '天数只能增加不能减少')
      }
      if (data.dayCount > DAY_COUNT_MAX) {
        throw new RouteBookRuleError('invalid', `天数最多 ${DAY_COUNT_MAX}`)
      }
    }

    if (data.title != null) book.title = data.title
    if (data.status != null) book.status = data.status
    if (data.metadata !== undefined) book.metadata = data.metadata
    if (data.startDate !== undefined) book.startDate = data.startDate

    if (data.dayCount !== undefined && data.dayCount > book.dayCount) {
      this.createDays(book, book.dayCount + 1, data.dayCount)
      book.dayCount = data.dayCount
    }
    if (data.startDate !== undefined) this.recomputeDayDates(book)

    this.touch(book)
    return book
  }

  async delete(id: string, userId: string): Promise<RouteBook | null> {
    const book = this.byId.get(id)
    if (!book || book.userId !== userId) return null

    for (const item of this.listBookItems(id)) this.itemsById.delete(item.id)
    for (const day of this.bookDays(id)) this.daysById.delete(day.id)
    for (const place of Array.from(this.placesById.values())) {
      if (place.routeBookId === id) this.placesById.delete(place.id)
    }
    for (const lodging of Array.from(this.lodgingsById.values())) {
      if (lodging.routeBookId === id) this.lodgingsById.delete(lodging.id)
    }
    this.byId.delete(id)
    return book
  }

  async getById(id: string, userId: string): Promise<RouteBookDetail | null> {
    const book = this.byId.get(id)
    if (!book || book.userId !== userId) return null

    return {
      ...book,
      days: this.bookDays(id),
      items: this.listBookItems(id),
      places: Array.from(this.placesById.values()).filter((place) => place.routeBookId === id),
      lodgings: Array.from(this.lodgingsById.values()).filter((lodging) => lodging.routeBookId === id),
    }
  }

  async listByUser(userId: string, filters?: { status?: RouteBookStatus }): Promise<RouteBookListItem[]> {
    return Array.from(this.byId.values())
      .filter((b) => b.userId === userId)
      .filter((b) => !filters?.status || b.status === filters.status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((b) => ({ ...b, firstPointImage: null }))
  }

  private requireDay(routeBookId: string, dayId: string): RouteBookDay {
    const day = this.daysById.get(dayId)
    if (!day || day.routeBookId !== routeBookId) throw new RouteBookRuleError('invalid', '目标天不存在')
    return day
  }

  async insertDay(routeBookId: string, userId: string, afterDayIndex: number): Promise<WithBookUpdatedAt<RouteBookDay>> {
    const book = this.requireBook(routeBookId, userId)
    if (afterDayIndex < 0 || afterDayIndex > book.dayCount) {
      throw new RouteBookRuleError('invalid', '插入位置无效')
    }
    if (book.dayCount + 1 > DAY_COUNT_MAX) {
      throw new RouteBookRuleError('invalid', `天数最多 ${DAY_COUNT_MAX}`)
    }

    for (const day of this.bookDays(routeBookId)) {
      if (day.dayIndex > afterDayIndex) day.dayIndex += 1
    }
    for (const lodging of this.lodgingsById.values()) {
      if (lodging.routeBookId !== routeBookId) continue
      const shifted = shiftLodgingForInsert(lodging, afterDayIndex)
      lodging.fromDayIndex = shifted.fromDayIndex
      lodging.toDayIndex = shifted.toDayIndex
    }

    const day: RouteBookDay = {
      id: this.idFactory(),
      routeBookId,
      dayIndex: afterDayIndex + 1,
      date: computeDayDate(book.startDate, afterDayIndex + 1),
      title: null,
      defaultTravelMode: 'transit',
    }
    this.daysById.set(day.id, day)
    book.dayCount += 1
    this.recomputeDayDates(book)
    const bookUpdatedAt = this.touch(book)
    return { ...day, bookUpdatedAt }
  }

  async updateDay(
    routeBookId: string,
    userId: string,
    dayId: string,
    data: { title?: string | null; defaultTravelMode?: TravelMode }
  ): Promise<WithBookUpdatedAt<RouteBookDay> | null> {
    const book = this.requireBook(routeBookId, userId)
    const day = this.daysById.get(dayId)
    if (!day || day.routeBookId !== routeBookId) return null

    if (data.title !== undefined) day.title = data.title
    if (data.defaultTravelMode !== undefined) day.defaultTravelMode = data.defaultTravelMode
    const bookUpdatedAt = this.touch(book)
    return { ...day, bookUpdatedAt }
  }

  async deleteDay(routeBookId: string, userId: string, dayId: string): Promise<WriteReceipt | null> {
    const book = this.requireBook(routeBookId, userId)
    const day = this.daysById.get(dayId)
    if (!day || day.routeBookId !== routeBookId) return null

    if (book.dayCount <= 1) {
      throw new RouteBookRuleError('invalid', '至少要保留一天')
    }
    if (this.dayItems(routeBookId, dayId).length > 0) {
      throw new RouteBookRuleError('day_not_empty', '先清空这一天再删除')
    }

    const delIndex = day.dayIndex
    this.daysById.delete(dayId)
    for (const other of this.bookDays(routeBookId)) {
      if (other.dayIndex > delIndex) other.dayIndex -= 1
    }
    for (const lodging of Array.from(this.lodgingsById.values())) {
      if (lodging.routeBookId !== routeBookId) continue
      const shifted = shiftLodgingForDelete(lodging, delIndex)
      if (!shifted) this.lodgingsById.delete(lodging.id)
      else {
        lodging.fromDayIndex = shifted.fromDayIndex
        lodging.toDayIndex = shifted.toDayIndex
      }
    }
    book.dayCount -= 1
    this.recomputeDayDates(book)
    const bookUpdatedAt = this.touch(book)
    return { bookUpdatedAt }
  }

  async reorderDays(routeBookId: string, userId: string, orderedDayIds: string[]): Promise<DayReorderResult> {
    const book = this.requireBook(routeBookId, userId)
    const days = this.bookDays(routeBookId)
    const currentIds = new Set(days.map((day) => day.id))
    const orderedSet = new Set(orderedDayIds)
    if (orderedDayIds.length !== currentIds.size || orderedDayIds.some((id) => !currentIds.has(id)) || orderedSet.size !== orderedDayIds.length) {
      throw new RouteBookRuleError('invalid', '列表与当前天数不一致，请刷新')
    }

    orderedDayIds.forEach((id, index) => {
      const day = this.daysById.get(id)
      if (day) day.dayIndex = index + 1
    })
    this.recomputeDayDates(book)
    const bookUpdatedAt = this.touch(book)
    return { days: this.bookDays(routeBookId), bookUpdatedAt }
  }

  async createItem(routeBookId: string, userId: string, input: ItemCreateInput): Promise<ItemCreateResult> {
    const book = this.requireBook(routeBookId, userId)

    if (input.dayId !== null) {
      this.requireDay(routeBookId, input.dayId)
    }

    this.assertItemShape(routeBookId, input)

    if (input.kind === 'point') {
      const group = this.dayItems(routeBookId, input.dayId)
      const existing = group.find((item) => item.kind === 'point' && item.pointId === input.pointId)
      if (existing) {
        return { item: { ...existing }, items: group, bookUpdatedAt: book.updatedAt }
      }
    }

    const group = this.dayItems(routeBookId, input.dayId)
    if (input.dayId !== null && (input.kind === 'point' || input.kind === 'place')) {
      assertDayLimit(countVisitable(group) + 1)
    }

    const insertAt = Math.min(Math.max(input.index ?? group.length, 0), group.length)
    const itemId = this.idFactory()
    const item: RouteBookItem = {
      id: itemId,
      routeBookId,
      dayId: input.dayId,
      sortOrder: insertAt,
      kind: input.kind,
      pointId: input.pointId ?? null,
      placeId: input.placeId ?? null,
      title: input.title ?? null,
      note: input.note ?? null,
      timeStart: input.timeStart ?? null,
      timeEnd: null,
      locked: false,
      icon: null,
      color: null,
      legMode: null,
      payload: input.payload ?? null,
      createdAt: this.now(),
    }

    for (const other of group) {
      if (other.sortOrder >= insertAt) {
        this.itemsById.set(other.id, { ...other, sortOrder: other.sortOrder + 1 })
      }
    }
    this.itemsById.set(item.id, item)
    this.rewriteDayOrder(routeBookId, input.dayId)
    const bookUpdatedAt = this.touch(book)
    const items = this.dayItems(routeBookId, input.dayId)
    const stored = items.find((row) => row.id === itemId) ?? item
    return { item: stored, items, bookUpdatedAt }
  }

  private assertItemShape(routeBookId: string, input: ItemCreateInput): void {
    if (input.kind === 'point') {
      if (!input.pointId) throw new RouteBookRuleError('invalid', '点位条目缺少 pointId')
      if (!this.pointBangumiMap.has(input.pointId)) throw new RouteBookRuleError('invalid', '点位不存在')
    }
    if (input.kind === 'place') {
      if (!input.placeId) throw new RouteBookRuleError('invalid', '自定义点条目缺少 placeId')
      const place = this.placesById.get(input.placeId)
      if (!place || place.routeBookId !== routeBookId) throw new RouteBookRuleError('invalid', '自定义点不存在')
    }
    if ((input.kind === 'note' || input.kind === 'transit') && !input.title) {
      throw new RouteBookRuleError('invalid', '标题不能为空')
    }
  }

  async updateItem(
    routeBookId: string,
    userId: string,
    itemId: string,
    data: ItemUpdateInput
  ): Promise<WithBookUpdatedAt<RouteBookItem> | null> {
    const book = this.requireBook(routeBookId, userId)
    const item = this.itemsById.get(itemId)
    if (!item || item.routeBookId !== routeBookId) return null

    // 先在副本上校验，通过后再写回（与 Prisma 事务回滚行为一致）
    const candidate: RouteBookItem = { ...item }
    if (data.title !== undefined) candidate.title = data.title
    if (data.note !== undefined) candidate.note = data.note
    if (data.timeStart !== undefined) candidate.timeStart = data.timeStart
    if (data.timeEnd !== undefined) candidate.timeEnd = data.timeEnd
    if (data.locked !== undefined) candidate.locked = data.locked
    if (data.icon !== undefined) candidate.icon = data.icon
    if (data.color !== undefined) candidate.color = data.color
    if (data.legMode !== undefined) candidate.legMode = data.legMode

    if (data.timeStart !== undefined || data.locked !== undefined) {
      assertAnchorOrder(this.dayItems(routeBookId, item.dayId).map((row) => (row.id === itemId ? candidate : row)))
    }

    this.itemsById.set(itemId, candidate)
    const bookUpdatedAt = this.touch(book)
    return { ...candidate, bookUpdatedAt }
  }

  async deleteItem(routeBookId: string, userId: string, itemId: string): Promise<WriteReceipt | null> {
    const book = this.requireBook(routeBookId, userId)
    const item = this.itemsById.get(itemId)
    if (!item || item.routeBookId !== routeBookId) return null

    this.itemsById.delete(itemId)
    this.rewriteDayOrder(routeBookId, item.dayId)
    const bookUpdatedAt = this.touch(book)
    return { bookUpdatedAt }
  }

  async reorderItems(
    routeBookId: string,
    userId: string,
    dayId: string | null,
    orderedItemIds: string[]
  ): Promise<ItemListResult> {
    const book = this.requireBook(routeBookId, userId)

    if (dayId !== null) {
      this.requireDay(routeBookId, dayId)
    }

    const bookItems = this.listBookItems(routeBookId)
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
    // 先在副本上改并校验，失败整体还原（与 Prisma 事务回滚行为一致）
    const snapshot = new Map(this.itemsById)
    try {
      orderedItemIds.forEach((id, index) => {
        const item = byId.get(id)
        if (!item) return
        this.itemsById.set(id, { ...item, dayId, sortOrder: index })
      })

      this.rewriteDayOrder(routeBookId, dayId)
      for (const sourceDayId of affectedSourceDays) {
        this.rewriteDayOrder(routeBookId, sourceDayId)
      }

      assertAnchorOrder(this.dayItems(routeBookId, dayId))
    } catch (err) {
      this.itemsById.clear()
      for (const [id, item] of snapshot) this.itemsById.set(id, item)
      throw err
    }

    const bookUpdatedAt = this.touch(book)
    return { items: this.listBookItems(routeBookId), bookUpdatedAt }
  }

  async replaceDayOrder(
    routeBookId: string,
    userId: string,
    dayId: string,
    orderedItemIds: string[]
  ): Promise<ItemListResult> {
    const book = this.requireBook(routeBookId, userId)

    const dayItems = this.dayItems(routeBookId, dayId)
    const dayIds = new Set(dayItems.map((item) => item.id))
    const orderedSet = new Set(orderedItemIds)
    if (orderedSet.size !== orderedItemIds.length || orderedItemIds.length !== dayIds.size || orderedItemIds.some((id) => !dayIds.has(id))) {
      throw new RouteBookRuleError('invalid', '列表与当前条目不一致，请刷新')
    }

    orderedItemIds.forEach((id, index) => {
      const item = this.itemsById.get(id)
      if (item) this.itemsById.set(id, { ...item, sortOrder: index })
    })
    this.rewriteDayOrder(routeBookId, dayId)

    const bookUpdatedAt = this.touch(book)
    return { items: this.listBookItems(routeBookId), bookUpdatedAt }
  }

  async createPlace(routeBookId: string, userId: string, input: PlaceInput): Promise<WithBookUpdatedAt<RouteBookPlace>> {
    const book = this.requireBook(routeBookId, userId)
    const count = Array.from(this.placesById.values()).filter((place) => place.routeBookId === routeBookId).length
    if (count >= PLACE_LIMIT) {
      throw new RouteBookRuleError('place_limit', `自定义点最多 ${PLACE_LIMIT} 个`)
    }

    const place: RouteBookPlace = {
      id: this.idFactory(),
      routeBookId,
      kind: input.kind,
      title: input.title,
      address: input.address ?? null,
      lat: input.lat,
      lng: input.lng,
      googlePlaceId: input.googlePlaceId ?? null,
      note: input.note ?? null,
      createdAt: this.now(),
    }
    this.placesById.set(place.id, place)
    const bookUpdatedAt = this.touch(book)
    return { ...place, bookUpdatedAt }
  }

  async updatePlace(
    routeBookId: string,
    userId: string,
    placeId: string,
    input: Partial<PlaceInput>
  ): Promise<WithBookUpdatedAt<RouteBookPlace> | null> {
    const book = this.requireBook(routeBookId, userId)
    const place = this.placesById.get(placeId)
    if (!place || place.routeBookId !== routeBookId) return null

    if (input.kind !== undefined) place.kind = input.kind
    if (input.title !== undefined) place.title = input.title
    if (input.address !== undefined) place.address = input.address
    if (input.lat !== undefined) place.lat = input.lat
    if (input.lng !== undefined) place.lng = input.lng
    if (input.googlePlaceId !== undefined) place.googlePlaceId = input.googlePlaceId
    if (input.note !== undefined) place.note = input.note

    const bookUpdatedAt = this.touch(book)
    return { ...place, bookUpdatedAt }
  }

  async deletePlace(routeBookId: string, userId: string, placeId: string): Promise<WriteReceipt | null> {
    const book = this.requireBook(routeBookId, userId)
    const place = this.placesById.get(placeId)
    if (!place || place.routeBookId !== routeBookId) return null

    const affectedDays = new Set<string | null>()
    for (const item of Array.from(this.itemsById.values())) {
      if (item.routeBookId === routeBookId && item.placeId === placeId) {
        affectedDays.add(item.dayId)
        this.itemsById.delete(item.id)
      }
    }
    for (const lodging of Array.from(this.lodgingsById.values())) {
      if (lodging.routeBookId === routeBookId && lodging.placeId === placeId) {
        this.lodgingsById.delete(lodging.id)
      }
    }
    this.placesById.delete(placeId)
    for (const dayId of affectedDays) this.rewriteDayOrder(routeBookId, dayId)
    const bookUpdatedAt = this.touch(book)
    return { bookUpdatedAt }
  }

  async createLodging(routeBookId: string, userId: string, input: LodgingInput): Promise<WithBookUpdatedAt<RouteBookLodging>> {
    const book = this.requireBook(routeBookId, userId)
    this.assertLodgingShape(routeBookId, input)

    const lodging: RouteBookLodging = {
      id: this.idFactory(),
      routeBookId,
      placeId: input.placeId,
      fromDayIndex: input.fromDayIndex,
      toDayIndex: input.toDayIndex,
      checkIn: input.checkIn ?? null,
      checkOut: input.checkOut ?? null,
      note: input.note ?? null,
    }
    assertLodgingNoOverlap(this.bookLodgings(routeBookId), lodging)
    this.lodgingsById.set(lodging.id, lodging)
    const bookUpdatedAt = this.touch(book)
    return { ...lodging, bookUpdatedAt }
  }

  private assertLodgingShape(routeBookId: string, input: Partial<LodgingInput> & { placeId?: string }): void {
    const placeId = input.placeId
    if (!placeId) throw new RouteBookRuleError('invalid', '住宿缺少 placeId')
    const place = this.placesById.get(placeId)
    if (!place || place.routeBookId !== routeBookId || place.kind !== 'lodging') {
      throw new RouteBookRuleError('invalid', '住宿地点必须是本行程本的酒店自定义点')
    }
    const from = input.fromDayIndex
    const to = input.toDayIndex
    if (from === undefined || to === undefined || from < 1 || to < from) {
      throw new RouteBookRuleError('invalid', '退房日不能早于入住日')
    }
  }

  private bookLodgings(routeBookId: string): RouteBookLodging[] {
    return Array.from(this.lodgingsById.values()).filter((lodging) => lodging.routeBookId === routeBookId)
  }

  async updateLodging(
    routeBookId: string,
    userId: string,
    lodgingId: string,
    input: Partial<LodgingInput>
  ): Promise<WithBookUpdatedAt<RouteBookLodging> | null> {
    const book = this.requireBook(routeBookId, userId)
    const lodging = this.lodgingsById.get(lodgingId)
    if (!lodging || lodging.routeBookId !== routeBookId) return null

    const candidate: RouteBookLodging = {
      ...lodging,
      ...('placeId' in input && input.placeId !== undefined ? { placeId: input.placeId } : {}),
      ...(input.fromDayIndex !== undefined ? { fromDayIndex: input.fromDayIndex } : {}),
      ...(input.toDayIndex !== undefined ? { toDayIndex: input.toDayIndex } : {}),
      ...(input.checkIn !== undefined ? { checkIn: input.checkIn } : {}),
      ...(input.checkOut !== undefined ? { checkOut: input.checkOut } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    }
    this.assertLodgingShape(routeBookId, candidate)
    assertLodgingNoOverlap(this.bookLodgings(routeBookId), candidate)

    lodging.placeId = candidate.placeId
    lodging.fromDayIndex = candidate.fromDayIndex
    lodging.toDayIndex = candidate.toDayIndex
    lodging.checkIn = candidate.checkIn
    lodging.checkOut = candidate.checkOut
    lodging.note = candidate.note

    const bookUpdatedAt = this.touch(book)
    return { ...lodging, bookUpdatedAt }
  }

  async deleteLodging(routeBookId: string, userId: string, lodgingId: string): Promise<WriteReceipt | null> {
    const book = this.requireBook(routeBookId, userId)
    const lodging = this.lodgingsById.get(lodgingId)
    if (!lodging || lodging.routeBookId !== routeBookId) return null

    this.lodgingsById.delete(lodgingId)
    const bookUpdatedAt = this.touch(book)
    return { bookUpdatedAt }
  }

  async isPointInAnyRouteBook(userId: string, pointId: string): Promise<boolean> {
    for (const book of this.byId.values()) {
      if (book.userId !== userId) continue
      for (const item of this.itemsById.values()) {
        if (item.routeBookId === book.id && item.kind === 'point' && item.pointId === pointId) return true
      }
    }
    return false
  }

  async listPointRefsByUser(userId: string, filters?: RouteBookPointListFilters): Promise<RouteBookPointRef[]> {
    const merged = new Map<string, Date>()

    for (const book of this.byId.values()) {
      if (book.userId !== userId) continue
      for (const item of this.itemsById.values()) {
        if (item.routeBookId !== book.id || item.kind !== 'point' || !item.pointId) continue
        if (filters?.bangumiId !== undefined) {
          const bangumiId = this.pointBangumiMap.get(item.pointId)
          if (bangumiId !== filters.bangumiId) continue
        }
        const seen = merged.get(item.pointId)
        if (!seen || seen.getTime() < book.updatedAt.getTime()) {
          merged.set(item.pointId, book.updatedAt)
        }
      }
    }

    return Array.from(merged.entries())
      .map(([pointId, updatedAt]) => ({ pointId, updatedAt }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }
}

function countVisitable(items: Pick<RouteBookItem, 'kind'>[]): number {
  return items.filter((item) => item.kind === 'point' || item.kind === 'place').length
}
