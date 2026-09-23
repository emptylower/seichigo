import { DAY_COUNT_MAX, DAY_ITEM_LIMIT, PLACE_LIMIT, RouteBookItem, RouteBookLodging, RouteBookRuleError } from './repo'

export { DAY_COUNT_MAX, DAY_ITEM_LIMIT, PLACE_LIMIT, RouteBookRuleError }

/** 时间锚：locked === true 且 timeStart 非空的条目才参与顺序约束 */
export function isAnchor(item: Pick<RouteBookItem, 'locked' | 'timeStart'>): boolean {
  return item.locked && item.timeStart != null
}

function anchorTitle(item: Pick<RouteBookItem, 'kind' | 'title'>): string {
  if (item.title) return item.title
  if (item.kind === 'point') return '点位'
  if (item.kind === 'place') return '地点'
  return '条目'
}

/** 按 sortOrder 取全部锚，timeStart 必须非递减，否则抛 anchor_order */
export function assertAnchorOrder(items: Pick<RouteBookItem, 'id' | 'sortOrder' | 'locked' | 'timeStart' | 'title' | 'kind'>[]): void {
  const anchors = [...items]
    .filter(isAnchor)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  for (let i = 1; i < anchors.length; i++) {
    const earlier = anchors[i - 1]
    const later = anchors[i]
    if ((later.timeStart ?? '') < (earlier.timeStart ?? '')) {
      throw new RouteBookRuleError(
        'anchor_order',
        `「${anchorTitle(later)}」(${later.timeStart}) 必须排在「${anchorTitle(earlier)}」(${earlier.timeStart}) 之后`
      )
    }
  }
}

/** 每天上限只统计 kind ∈ {point, place}；传入的是"写入后将达到的数量" */
export function assertDayLimit(count: number): void {
  if (count > DAY_ITEM_LIMIT) {
    throw new RouteBookRuleError('day_limit', `这一天最多 ${DAY_ITEM_LIMIT} 条`)
  }
}

/** 住宿的夜晚集合：[from, to-1]；from == to 表示当天不过夜但以此为锚 */
export function lodgingNights(lodging: Pick<RouteBookLodging, 'fromDayIndex' | 'toDayIndex'>): number[] {
  const nights: number[] = []
  for (let n = lodging.fromDayIndex; n < lodging.toDayIndex; n++) nights.push(n)
  return nights
}

/** 与同本其它区间的夜晚集合不相交（[1,3] 与 [3,5] 允许——背靠背） */
export function assertLodgingNoOverlap(
  list: Pick<RouteBookLodging, 'id' | 'fromDayIndex' | 'toDayIndex'>[],
  candidate: Pick<RouteBookLodging, 'id' | 'fromDayIndex' | 'toDayIndex'>
): void {
  const candidateNights = new Set(lodgingNights(candidate))
  for (const other of list) {
    if (other.id === candidate.id) continue
    for (const night of lodgingNights(other)) {
      if (candidateNights.has(night)) {
        throw new RouteBookRuleError('lodging_overlap', '住宿日期与已有住宿重叠')
      }
    }
  }
}

export function shiftLodgingForInsert<T extends { fromDayIndex: number; toDayIndex: number }>(lodging: T, afterDayIndex: number): T {
  return {
    ...lodging,
    fromDayIndex: lodging.fromDayIndex > afterDayIndex ? lodging.fromDayIndex + 1 : lodging.fromDayIndex,
    toDayIndex: lodging.toDayIndex > afterDayIndex ? lodging.toDayIndex + 1 : lodging.toDayIndex,
  }
}

/** 返回 null 表示 to < from，整条删除 */
export function shiftLodgingForDelete<T extends { fromDayIndex: number; toDayIndex: number }>(lodging: T, delDayIndex: number): T | null {
  const fromDayIndex = lodging.fromDayIndex > delDayIndex ? lodging.fromDayIndex - 1 : lodging.fromDayIndex
  const toDayIndex = lodging.toDayIndex >= delDayIndex ? lodging.toDayIndex - 1 : lodging.toDayIndex
  if (toDayIndex < fromDayIndex) return null
  return { ...lodging, fromDayIndex, toDayIndex }
}

/** date = startDate + (dayIndex-1) 天；startDate 为 null 时各天 date 为 null */
export function computeDayDate(startDate: Date | null, dayIndex: number): Date | null {
  if (!startDate) return null
  return new Date(startDate.getTime() + (dayIndex - 1) * 86_400_000)
}

export type TransitBetween = { prevItemId: string; nextItemId: string }

export function readTransitBetween(payload: RouteBookItem['payload']): TransitBetween | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raw = (payload as Record<string, unknown>).transitBetween
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.prevItemId !== 'string' || !record.prevItemId) return null
  if (typeof record.nextItemId !== 'string' || !record.nextItemId) return null
  return { prevItemId: record.prevItemId, nextItemId: record.nextItemId }
}

export type NormalizedTransit = {
  items: RouteBookItem[]
  /** prevItemId 条目不在这一天而被删除的 transit 条目 */
  deletedTransitItemIds: string[]
}

/**
 * 交通条目附着：把每个 transit 条目移到 prevItemId 条目的紧后面；
 * prevItemId 条目不在这一天 → 删除该 transit 条目。输出按 0..n 重编 sortOrder。
 */
export function normalizeTransitItems(items: RouteBookItem[]): NormalizedTransit {
  const byId = new Map(items.map((item) => [item.id, item]))
  const transitsByPrev = new Map<string, RouteBookItem[]>()
  const deletedTransitItemIds: string[] = []
  const ordered: RouteBookItem[] = []

  for (const item of items) {
    if (item.kind !== 'transit') {
      ordered.push(item)
      continue
    }
    const between = readTransitBetween(item.payload)
    if (!between) {
      ordered.push(item)
      continue
    }
    const prev = byId.get(between.prevItemId)
    if (!prev || prev.kind === 'transit') {
      deletedTransitItemIds.push(item.id)
      continue
    }
    const bucket = transitsByPrev.get(prev.id)
    if (bucket) bucket.push(item)
    else transitsByPrev.set(prev.id, [item])
  }

  const out: RouteBookItem[] = []
  for (const item of ordered) {
    out.push(item)
    for (const transit of transitsByPrev.get(item.id) ?? []) {
      out.push(transit)
    }
  }

  return {
    items: out.map((item, index) => (item.sortOrder === index ? item : { ...item, sortOrder: index })),
    deletedTransitItemIds,
  }
}
