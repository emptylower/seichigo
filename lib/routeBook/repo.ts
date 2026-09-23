import type { Prisma } from '@prisma/client'

export const DAY_ITEM_LIMIT = 25
export const PLACE_LIMIT = 50
export const DAY_COUNT_MAX = 30

export type RouteBookStatus = 'draft' | 'in_progress' | 'completed'

export type TravelMode = 'transit' | 'walking' | 'driving'
export type ItemKind = 'point' | 'place' | 'note' | 'transit'
export type PlaceKind = 'lodging' | 'station' | 'restaurant' | 'other'

export type RouteBook = {
  id: string
  userId: string
  title: string
  status: RouteBookStatus
  metadata: Prisma.JsonValue | null
  startDate: Date | null
  dayCount: number
  createdAt: Date
  updatedAt: Date
}

export type RouteBookListItem = RouteBook & {
  firstPointImage?: string | null
}

export type RouteBookDay = {
  id: string
  routeBookId: string
  dayIndex: number
  date: Date | null
  title: string | null
  defaultTravelMode: TravelMode
}

export type RouteBookItem = {
  id: string
  routeBookId: string
  dayId: string | null
  sortOrder: number
  kind: ItemKind
  pointId: string | null
  placeId: string | null
  title: string | null
  note: string | null
  timeStart: string | null
  timeEnd: string | null
  locked: boolean
  icon: string | null
  color: string | null
  legMode: TravelMode | null
  payload: Prisma.JsonValue | null
  createdAt: Date
}

export type RouteBookPlace = {
  id: string
  routeBookId: string
  kind: PlaceKind
  title: string
  address: string | null
  lat: number
  lng: number
  /** 关联的谷歌地点 id（plan agent 外部地点），供点位介绍接口使用 */
  googlePlaceId?: string | null
  note: string | null
  createdAt: Date
}

export type RouteBookLodging = {
  id: string
  routeBookId: string
  placeId: string
  fromDayIndex: number
  toDayIndex: number
  checkIn: string | null
  checkOut: string | null
  note: string | null
}

export type RouteBookDetail = RouteBook & {
  days: RouteBookDay[]
  items: RouteBookItem[]
  places: RouteBookPlace[]
  lodgings: RouteBookLodging[]
}

/** 单天上下文（legs 接口瘦身用）：天 + 仅该天条目 + 本级 places/lodgings */
export type DayContext = {
  day: RouteBookDay
  items: RouteBookItem[]
  places: RouteBookPlace[]
  lodgings: RouteBookLodging[]
}

export type RouteBookUpdateInput = {
  title?: string
  status?: RouteBookStatus
  metadata?: Prisma.JsonValue | null
  startDate?: Date | null
  dayCount?: number
}

export type RouteBookListFilters = {
  status?: RouteBookStatus
}

export type RouteBookPointListFilters = {
  bangumiId?: number
}

export type RouteBookPointRef = {
  pointId: string
  updatedAt: Date
}

export type ItemCreateInput = {
  dayId: string | null
  kind: ItemKind
  pointId?: string
  placeId?: string
  title?: string
  note?: string
  timeStart?: string
  index?: number
  /** 导入/创建 transit 条目时写入 transitBetween 等结构化载荷 */
  payload?: Prisma.JsonValue
}

export type ItemUpdateInput = {
  title?: string | null
  note?: string | null
  timeStart?: string | null
  timeEnd?: string | null
  locked?: boolean
  icon?: string | null
  color?: string | null
  legMode?: TravelMode | null
}

export type PlaceInput = {
  kind: PlaceKind
  title: string
  address?: string | null
  lat: number
  lng: number
  googlePlaceId?: string | null
  note?: string | null
}

export type LodgingInput = {
  placeId: string
  fromDayIndex: number
  toDayIndex: number
  checkIn?: string | null
  checkOut?: string | null
  note?: string | null
}

export class RouteBookRuleError extends Error {
  constructor(
    readonly reason: 'day_limit' | 'place_limit' | 'anchor_order' | 'day_not_empty' | 'lodging_overlap' | 'stale' | 'not_found' | 'invalid',
    message: string
  ) {
    super(message)
    this.name = 'RouteBookRuleError'
  }
}

export type WithBookUpdatedAt<T> = T & { bookUpdatedAt: Date }
/** 删除类写操作的回执：目标存在时返回推进后的时间戳 */
export type WriteReceipt = { bookUpdatedAt: Date }
/** POST /items：新条目 + 目标天（或未安排区）写入后的完整条目列表 */
export type ItemCreateResult = { item: RouteBookItem; items: RouteBookItem[]; bookUpdatedAt: Date }
export type DayReorderResult = { days: RouteBookDay[]; bookUpdatedAt: Date }
export type ItemListResult = { items: RouteBookItem[]; bookUpdatedAt: Date }

export interface RouteBookRepo {
  /** 自动建 Day 1..dayCount */
  create(
    userId: string,
    title: string,
    status: RouteBookStatus,
    opts?: { startDate?: Date | null; dayCount?: number }
  ): Promise<RouteBook>
  /** dayCount 增大时补建天；startDate 变化时重算各天 date；expectedUpdatedAt 不匹配抛 stale */
  update(id: string, userId: string, data: RouteBookUpdateInput, expectedUpdatedAt?: Date): Promise<RouteBook | null>
  delete(id: string, userId: string): Promise<RouteBook | null>
  getById(id: string, userId: string): Promise<RouteBookDetail | null>
  /** 单天上下文，一条查询拿齐；book/user/day 任一不匹配返回 null */
  getDayContext(routeBookId: string, userId: string, dayId: string): Promise<DayContext | null>
  listByUser(userId: string, filters?: RouteBookListFilters): Promise<RouteBookListItem[]>

  insertDay(routeBookId: string, userId: string, afterDayIndex: number): Promise<WithBookUpdatedAt<RouteBookDay>>
  updateDay(
    routeBookId: string,
    userId: string,
    dayId: string,
    data: { title?: string | null; defaultTravelMode?: TravelMode }
  ): Promise<WithBookUpdatedAt<RouteBookDay> | null>
  /** 非空抛 day_not_empty；最后一天不允许删（invalid） */
  deleteDay(routeBookId: string, userId: string, dayId: string): Promise<WriteReceipt | null>
  reorderDays(routeBookId: string, userId: string, orderedDayIds: string[]): Promise<DayReorderResult>

  createItem(routeBookId: string, userId: string, input: ItemCreateInput): Promise<ItemCreateResult>
  updateItem(
    routeBookId: string,
    userId: string,
    itemId: string,
    data: ItemUpdateInput
  ): Promise<WithBookUpdatedAt<RouteBookItem> | null>
  deleteItem(routeBookId: string, userId: string, itemId: string): Promise<WriteReceipt | null>
  /** 返回全部 items；dayId 必须归属本行程本，否则 invalid */
  reorderItems(routeBookId: string, userId: string, dayId: string | null, orderedItemIds: string[]): Promise<ItemListResult>
  /** optimize 写回用，不做锚校验（optimize 自己保证） */
  replaceDayOrder(
    routeBookId: string,
    userId: string,
    dayId: string,
    orderedItemIds: string[]
  ): Promise<ItemListResult>

  createPlace(routeBookId: string, userId: string, input: PlaceInput): Promise<WithBookUpdatedAt<RouteBookPlace>>
  updatePlace(
    routeBookId: string,
    userId: string,
    placeId: string,
    input: Partial<PlaceInput>
  ): Promise<WithBookUpdatedAt<RouteBookPlace> | null>
  /** 级联删 items/lodgings */
  deletePlace(routeBookId: string, userId: string, placeId: string): Promise<WriteReceipt | null>

  createLodging(routeBookId: string, userId: string, input: LodgingInput): Promise<WithBookUpdatedAt<RouteBookLodging>>
  updateLodging(
    routeBookId: string,
    userId: string,
    lodgingId: string,
    input: Partial<LodgingInput>
  ): Promise<WithBookUpdatedAt<RouteBookLodging> | null>
  deleteLodging(routeBookId: string, userId: string, lodgingId: string): Promise<WriteReceipt | null>

  /** 查 items kind=point */
  isPointInAnyRouteBook(userId: string, pointId: string): Promise<boolean>
  listPointRefsByUser(userId: string, filters?: RouteBookPointListFilters): Promise<RouteBookPointRef[]>
}
