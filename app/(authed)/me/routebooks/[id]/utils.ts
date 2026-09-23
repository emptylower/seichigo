import type { DayRecord, ItemRecord, PlaceRecord, PointPreview, NavMode } from './types'
import { NAV_MODE_PARAM, POINT_FALLBACK_GRADIENTS, ITEM_DND_PREFIX, POOL_DND_PREFIX, MARKER_DND_PREFIX, DAY_DROP_PREFIX, UNASSIGNED_DROP_ID } from './types'

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

const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** `Day N`，有日期时追加 ` · M/D 周X`（按 UTC 读，存的就是 UTC 00:00） */
export function dayLabel(day: Pick<DayRecord, 'date'>, index: number): string {
  const base = `Day ${index}`
  if (!day.date) return base
  const parsed = new Date(day.date)
  if (Number.isNaN(parsed.getTime())) return base
  return `${base} · ${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()} ${WEEKDAY_LABEL[parsed.getUTCDay()]}`
}

export function itemDisplayTitle(
  item: Pick<ItemRecord, 'kind' | 'title' | 'placeId'>,
  preview: PointPreview | null | undefined,
  places: Pick<PlaceRecord, 'id' | 'title'>[]
): string {
  if (item.kind === 'point') {
    return preview?.title || item.title || '点位'
  }
  if (item.kind === 'place') {
    const place = places.find((row) => row.id === item.placeId)
    return place?.title || item.title || '地点'
  }
  return item.title || (item.kind === 'transit' ? '交通' : '备注')
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

export function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '最近更新'
  return parsed.toLocaleDateString('zh-CN')
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

export function buildFallbackPreview(pointId: string): PointPreview {
  return {
    title: `点位 ${parsePointKey(pointId)}`,
    subtitle: `番剧 #${parseBangumiId(pointId) || '未知'}`,
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
