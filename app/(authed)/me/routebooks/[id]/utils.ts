import type { DayRecord, ItemRecord, LodgingRecord, PlaceRecord, PointPreview, RouteBookDetail, NavMode } from './types'
import { NAV_MODE_PARAM, POINT_FALLBACK_GRADIENTS, ITEM_DND_PREFIX, POOL_DND_PREFIX, MARKER_DND_PREFIX, DAY_DROP_PREFIX, UNASSIGNED_DROP_ID } from './types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { toIntlLocale } from '@/lib/i18n/intlLocale'
import { tr } from '../i18n'

export function groupItemsByDay(
  items: ItemRecord[],
  days: DayRecord[]
): { byDay: Map<string, ItemRecord[]>; unassigned: ItemRecord[] } {
  const byDay = new Map<string, ItemRecord[]>()
  for (const day of days) byDay.set(day.id, [])
  const unassigned: ItemRecord[] = []

  for (const item of items) {
    if (item.dayId && byDay.has(item.dayId)) {
      byDay.get(item.dayId)!.push(item)
    } else {
      unassigned.push(item)
    }
  }

  for (const list of byDay.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)
  unassigned.sort((a, b) => a.sortOrder - b.sortOrder)
  return { byDay, unassigned }
}

/**
 * 乐观更新：与服务端 reorderItems 的重编规则一致——目标天按 orderedItemIds
 * 重排（不在目标天的视为移入），其余各组保持相对顺序并从 0 重编 sortOrder。
 */
export function applyReorderLocal(
  items: ItemRecord[],
  targetDayId: string | null,
  orderedItemIds: string[]
): ItemRecord[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const movedIds = new Set(orderedItemIds)
  const next: ItemRecord[] = []

  orderedItemIds.forEach((id, index) => {
    const item = byId.get(id)
    if (!item) return
    next.push({ ...item, dayId: targetDayId, sortOrder: index })
  })

  const remainingGroups = new Map<string | null, ItemRecord[]>()
  for (const item of items) {
    if (movedIds.has(item.id)) continue
    const list = remainingGroups.get(item.dayId) ?? []
    list.push(item)
    remainingGroups.set(item.dayId, list)
  }
  for (const [dayId, list] of remainingGroups) {
    list
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((item, index) => {
        next.push({ ...item, dayId, sortOrder: index })
      })
  }

  return next
}

/** `Day N`，有日期时追加本地化日期与星期（按 UTC 读，存的就是 UTC 00:00） */
export function dayLabel(day: Pick<DayRecord, 'date'>, index: number, locale: SupportedLocale = 'zh'): string {
  const base = `Day ${index}`
  if (!day.date) return base
  const parsed = new Date(day.date)
  if (Number.isNaN(parsed.getTime())) return base
  const intl = toIntlLocale(locale)
  const weekday = new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' }).format(parsed)
  if (locale === 'en') {
    const md = new Intl.DateTimeFormat(intl, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)
    return `${base} · ${md}, ${weekday}`
  }
  const md = `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`
  return locale === 'ja' ? `${base} · ${md}(${weekday})` : `${base} · ${md} ${weekday}`
}

export function itemDisplayTitle(
  item: Pick<ItemRecord, 'kind' | 'title' | 'placeId'>,
  preview: PointPreview | null | undefined,
  places: Pick<PlaceRecord, 'id' | 'title'>[],
  locale: SupportedLocale = 'zh'
): string {
  if (item.kind === 'point') {
    return preview?.title || item.title || tr('routebook.common.pointFallback', locale)
  }
  if (item.kind === 'place') {
    const place = places.find((row) => row.id === item.placeId)
    return place?.title || item.title || tr('routebook.common.placeFallback', locale)
  }
  return item.title || tr(item.kind === 'transit' ? 'routebook.common.transitFallback' : 'routebook.common.noteFallback', locale)
}

/** 单天模式地图徽标 / 时间线序号：只数有坐标的 point/place，按 sortOrder 编 1..N */
export function computeVisitOrder(
  dayItems: ItemRecord[],
  places: PlaceRecord[],
  getPointPreview: (pointId: string) => PointPreview
): Map<string, number> {
  const map = new Map<string, number>()
  const sorted = [...dayItems].sort((a, b) => a.sortOrder - b.sortOrder)
  let n = 0
  for (const item of sorted) {
    if (item.kind !== 'point' && item.kind !== 'place') continue
    const hasCoord =
      item.kind === 'place'
        ? places.some((place) => place.id === item.placeId)
        : Boolean(item.pointId && getPointPreview(item.pointId).geo)
    if (!hasCoord) continue
    n += 1
    map.set(item.id, n)
  }
  return map
}

/** 沉浸模式序列：当天 point/place 条目按 sortOrder */
export function sequenceForImmersive(items: ItemRecord[], dayId: string): ItemRecord[] {
  return items
    .filter((item) => item.dayId === dayId && (item.kind === 'point' || item.kind === 'place'))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** 有日期匹配今天（本地日历日）则返回该天，否则第一天；无天返回 null */
export function pickTodayDayId(days: DayRecord[], now: Date): string | null {
  if (!days.length) return null
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  for (const day of sorted) {
    if (!day.date) continue
    const parsed = new Date(day.date)
    if (Number.isNaN(parsed.getTime())) continue
    if (parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m && parsed.getUTCDate() === d) {
      return day.id
    }
  }
  return sorted[0]!.id
}

export function formatDate(value: string, locale: SupportedLocale = 'zh'): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return tr('routebook.common.recentlyUpdated', locale)
  return parsed.toLocaleDateString(toIntlLocale(locale))
}

/** 与 lib/routeBook/rules.ts computeDayDate 一致：date = startDate + (dayIndex-1) 天（ISO 字符串版） */
export function computeDayDateIso(startDate: string | null, dayIndex: number): string | null {
  if (!startDate) return null
  const base = Date.parse(startDate)
  if (Number.isNaN(base)) return null
  return new Date(base + (dayIndex - 1) * 86_400_000).toISOString()
}

/** 与 shiftLodgingForInsert 一致：afterDayIndex 之后的区间端点 +1 */
export function shiftLodgingAfterInsert<T extends { fromDayIndex: number; toDayIndex: number }>(
  lodging: T,
  afterDayIndex: number
): T {
  return {
    ...lodging,
    fromDayIndex: lodging.fromDayIndex > afterDayIndex ? lodging.fromDayIndex + 1 : lodging.fromDayIndex,
    toDayIndex: lodging.toDayIndex > afterDayIndex ? lodging.toDayIndex + 1 : lodging.toDayIndex,
  }
}

/** 与 shiftLodgingForDelete 一致：返回 null 表示整段被删掉 */
export function shiftLodgingAfterDelete<T extends { fromDayIndex: number; toDayIndex: number }>(
  lodging: T,
  delDayIndex: number
): T | null {
  const fromDayIndex = lodging.fromDayIndex > delDayIndex ? lodging.fromDayIndex - 1 : lodging.fromDayIndex
  const toDayIndex = lodging.toDayIndex >= delDayIndex ? lodging.toDayIndex - 1 : lodging.toDayIndex
  if (toDayIndex < fromDayIndex) return null
  return { ...lodging, fromDayIndex, toDayIndex }
}

/** 插入天后的本地重编：之后的天 dayIndex/date +1，新天入列，dayCount+1，住宿顺移（与服务端 insertDayTx 一致） */
export function applyDayInsertLocal(
  detail: RouteBookDetail,
  day: DayRecord,
  updatedAt: string | null
): RouteBookDetail {
  const afterDayIndex = day.dayIndex - 1
  return {
    ...detail,
    dayCount: detail.dayCount + 1,
    updatedAt: updatedAt ?? detail.updatedAt,
    days: [
      ...detail.days.map((row) =>
        row.dayIndex > afterDayIndex
          ? { ...row, dayIndex: row.dayIndex + 1, date: computeDayDateIso(detail.startDate, row.dayIndex + 1) }
          : row
      ),
      day,
    ],
    lodgings: detail.lodgings.map((row) => shiftLodgingAfterInsert(row, afterDayIndex)),
  }
}

/** 删除天后的本地重编：删该天，之后的天 dayIndex/date -1，住宿顺移/整段删除（与服务端 deleteDayTx 一致） */
export function applyDayDeleteLocal(
  detail: RouteBookDetail,
  dayId: string,
  updatedAt: string | null
): RouteBookDetail | null {
  const target = detail.days.find((row) => row.id === dayId)
  if (!target) return null
  const delIndex = target.dayIndex
  return {
    ...detail,
    dayCount: detail.dayCount - 1,
    updatedAt: updatedAt ?? detail.updatedAt,
    days: detail.days
      .filter((row) => row.id !== dayId)
      .map((row) =>
        row.dayIndex > delIndex
          ? { ...row, dayIndex: row.dayIndex - 1, date: computeDayDateIso(detail.startDate, row.dayIndex - 1) }
          : row
      ),
    // 服务端只允许删空天；这里的 dayId→null 只是兜底
    items: detail.items.map((row) => (row.dayId === dayId ? { ...row, dayId: null } : row)),
    lodgings: detail.lodgings
      .map((row) => shiftLodgingAfterDelete(row, delIndex))
      .filter((row): row is LodgingRecord => row !== null),
  }
}

export function parseBangumiId(pointId: string): number | null {
  const [raw] = pointId.split(':')
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function parsePointKey(pointId: string): string {
  const sep = pointId.indexOf(':')
  if (sep < 0) return pointId
  return pointId.slice(sep + 1)
}

export function buildPointLookupCandidates(pointId: string): string[] {
  const raw = String(pointId || '').trim()
  if (!raw) return []

  const parsed = parsePointKey(raw)
  const bangumiId = parseBangumiId(raw)
  const out = new Set<string>()
  const push = (value: string | null | undefined) => {
    const normalized = String(value || '').trim()
    if (!normalized) return
    out.add(normalized)
    out.add(normalized.toLowerCase())
  }

  push(raw)
  push(parsed)
  if (bangumiId && parsed) {
    push(`${bangumiId}:${parsed}`)
  }

  return Array.from(out)
}

export function pickPointGradient(seed: string): string {
  let value = 0
  for (const char of seed) value = (value * 29 + char.charCodeAt(0)) % 997
  return POINT_FALLBACK_GRADIENTS[value % POINT_FALLBACK_GRADIENTS.length]
}

export function buildFallbackPreview(pointId: string, locale: SupportedLocale = 'zh'): PointPreview {
  const bangumiId = parseBangumiId(pointId)
  return {
    title: tr('routebook.common.pointFallback', locale) + ` ${parsePointKey(pointId)}`,
    subtitle: bangumiId
      ? tr('routebook.common.bangumiWork', locale, { id: bangumiId })
      : tr('routebook.common.bangumiWork', locale, { id: tr('routebook.common.unknown', locale) }),
    image: null,
    geo: null,
  }
}

export function buildGoogleDirectionsUrl(stops: string[], mode?: NavMode): string | null {
  if (!stops.length) return null

  if (stops.length === 1) {
    const params = new URLSearchParams({
      api: '1',
      destination: stops[0],
    })
    if (mode) {
      params.set('travelmode', NAV_MODE_PARAM[mode])
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`
  }

  const origin = stops[0]
  const destination = stops[stops.length - 1]
  if (!origin || !destination) return null

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
  })
  if (mode) {
    params.set('travelmode', NAV_MODE_PARAM[mode])
  }
  const waypoints = stops.slice(1, -1)
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.join('|'))
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function isGeoPair(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length < 2) return false
  const lat = Number(value[0])
  const lng = Number(value[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false
  return true
}

export function itemDragId(itemId: string): string {
  return `${ITEM_DND_PREFIX}${itemId}`
}

export function poolDragId(poolItemId: string): string {
  return `${POOL_DND_PREFIX}${poolItemId}`
}

export function markerDragId(itemId: string): string {
  return `${MARKER_DND_PREFIX}${itemId}`
}

export function dayDropId(dayId: string | null): string {
  return dayId === null ? UNASSIGNED_DROP_ID : `${DAY_DROP_PREFIX}${dayId}`
}

export function parseDragRecordId(rawId: string, prefix: string): string | null {
  if (!rawId.startsWith(prefix)) return null
  const value = rawId.slice(prefix.length)
  return value || null
}

/** over.id → 目标天（day:<dayId> / day:unassigned），非天投放返回 undefined */
export function parseDayDropId(rawId: string): string | null | undefined {
  if (rawId === UNASSIGNED_DROP_ID) return null
  if (!rawId.startsWith(DAY_DROP_PREFIX)) return undefined
  const value = rawId.slice(DAY_DROP_PREFIX.length)
  return value || undefined
}
