import crypto from 'node:crypto'
import {
  DAY_COUNT_MAX,
  RouteBookRuleError,
  computeDayDate,
  shiftLodgingForDelete,
  shiftLodgingForInsert,
} from './rules'
import type {
  DayReorderResult,
  RouteBook,
  RouteBookDay,
  RouteBookItem,
  RouteBookLodging,
  TravelMode,
  WithBookUpdatedAt,
  WriteReceipt,
} from './repo'

export type RouteBookMemoryDaysOptions = {
  now?: () => Date
  idFactory?: () => string
}

/**
 * repoMemory 的「天」子域基类（mixin 形态）：持有 days/items/lodgings 内存索引，
 * 实现 RouteBookRepo 的四个天级写操作（insertDay/updateDay/deleteDay/reorderDays）。
 * 书籍与自定义点等其余状态由 InMemoryRouteBookRepo 自持并通过抽象成员提供。
 */
export abstract class RouteBookMemoryDays {
  protected readonly now: () => Date
  protected readonly idFactory: () => string
  protected readonly daysById = new Map<string, RouteBookDay>()
  protected readonly itemsById = new Map<string, RouteBookItem>()
  protected readonly lodgingsById = new Map<string, RouteBookLodging>()

  /** 由主仓储提供：鉴权取书（缺失/越权抛 not_found） */
  protected abstract requireBook(routeBookId: string, userId: string): RouteBook
  /** 由主仓储提供：某天（或未安排区）的条目，已按全局顺序排序 */
  protected abstract dayItems(routeBookId: string, dayId: string | null): RouteBookItem[]

  constructor(options?: RouteBookMemoryDaysOptions) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
  }

  protected bookDays(routeBookId: string): RouteBookDay[] {
    return Array.from(this.daysById.values())
      .filter((day) => day.routeBookId === routeBookId)
      .sort((a, b) => a.dayIndex - b.dayIndex)
  }

  protected dayIndexOf(routeBookId: string, dayId: string | null): number {
    if (dayId === null) return Number.MAX_SAFE_INTEGER
    return this.daysById.get(dayId)?.dayIndex ?? Number.MAX_SAFE_INTEGER
  }

  protected touch(book: RouteBook): Date {
    book.updatedAt = this.now()
    return book.updatedAt
  }

  protected createDays(book: RouteBook, fromIndex: number, toIndex: number): void {
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

  protected recomputeDayDates(book: RouteBook): void {
    for (const day of this.bookDays(book.id)) {
      day.date = computeDayDate(book.startDate, day.dayIndex)
    }
  }

  protected requireDay(routeBookId: string, dayId: string): RouteBookDay {
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
}
