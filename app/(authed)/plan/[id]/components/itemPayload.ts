import type { TripPlanItemView } from '@/lib/tripPlan/view'
import { normalizeDaySchedule } from '@/lib/planAgent/schedule'

/**
 * TripPlanItem.payload 的读取/格式化助手（客户端安全，无服务端依赖）。
 * M3 的结构化段：schedule / place / transport / media；兼容 M1 的扁平交通
 * payload（mode/durationMin/distanceKm 直接挂在根上）。历史数据缺字段时
 * 一律返回 null/兜底文案，绝不动原始 payload。
 */

export type ScheduleConfidence = 'explicit' | 'reference' | 'estimated'

export type SchedulePayload = {
  start: string
  end: string
  confidence: ScheduleConfidence
}

export type PlacePayload = {
  placeId: string
  name: string
  lat: number
  lng: number
  mapsUri?: string
}

export type TransportLeg = {
  mode?: string
  durationMin?: number
  distanceKm?: number
  instruction?: string
  line?: string
  fromStop?: string
  toStop?: string
  numStops?: number
}

export type TransportPayload = {
  mode?: string
  durationMin?: number
  distanceKm?: number
  transfers?: number
  walkMin?: number
  provider?: string
  /** 日本公交覆盖缺口兜底：时长/距离是按道路距离推算的参考值，非真实时刻 */
  estimated?: boolean
  /** 兜底 transit 段附带的 Google 地图外链（前端渲染"在 Google 地图查看"） */
  mapsUrl?: string
  legs?: TransportLeg[]
  polyline?: Array<[number, number]>
}

export type MediaPayload = {
  source?: string
  displayUrl?: string
  attribution?: string
}

type PayloadRecord = Record<string, unknown>

function payloadRecord(item: TripPlanItemView): PayloadRecord | null {
  const payload = item.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return payload as PayloadRecord
}

function nested(record: PayloadRecord, key: string): PayloadRecord | null {
  const value = record[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as PayloadRecord
}

export function getSchedule(item: TripPlanItemView): SchedulePayload | null {
  const record = payloadRecord(item)
  const schedule = record ? nested(record, 'schedule') : null
  if (!schedule) return null
  const start = typeof schedule.start === 'string' ? schedule.start : null
  const end = typeof schedule.end === 'string' ? schedule.end : null
  if (!start || !end) return null
  const confidence =
    schedule.confidence === 'explicit' || schedule.confidence === 'reference' ? schedule.confidence : 'estimated'
  return { start, end, confidence }
}

/** 解析后的开始分钟数（防御性排序用；无 schedule 返回 null） */
export function scheduleStartMinutes(schedule: SchedulePayload): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(schedule.start)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function getPlace(item: TripPlanItemView): PlacePayload | null {
  const record = payloadRecord(item)
  const place = record ? nested(record, 'place') : null
  if (!place) return null
  const placeId = typeof place.placeId === 'string' ? place.placeId : null
  const name = typeof place.name === 'string' ? place.name : null
  const lat = Number(place.lat)
  const lng = Number(place.lng)
  if (!placeId || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    placeId,
    name,
    lat,
    lng,
    ...(typeof place.mapsUri === 'string' ? { mapsUri: place.mapsUri } : {}),
  }
}

export function getTransport(item: TripPlanItemView): TransportPayload | null {
  const record = payloadRecord(item)
  if (!record) return null
  const transport = nested(record, 'transport')
  const source = transport ?? record
  const result: TransportPayload = {}
  if (typeof source.mode === 'string') result.mode = source.mode
  if (Number.isFinite(Number(source.durationMin))) result.durationMin = Number(source.durationMin)
  if (Number.isFinite(Number(source.distanceKm))) result.distanceKm = Number(source.distanceKm)
  if (Number.isFinite(Number(source.transfers))) result.transfers = Number(source.transfers)
  if (Number.isFinite(Number(source.walkMin))) result.walkMin = Number(source.walkMin)
  if (typeof source.provider === 'string') result.provider = source.provider
  if (source.estimated === true) result.estimated = true
  if (typeof source.mapsUrl === 'string' && source.mapsUrl) result.mapsUrl = source.mapsUrl
  if (Array.isArray(source.legs)) {
    result.legs = source.legs
      .filter((leg): leg is Record<string, unknown> => Boolean(leg) && typeof leg === 'object' && !Array.isArray(leg))
      .map((leg) => ({
        ...(typeof leg.mode === 'string' ? { mode: leg.mode } : {}),
        ...(Number.isFinite(Number(leg.durationMin)) ? { durationMin: Number(leg.durationMin) } : {}),
        ...(Number.isFinite(Number(leg.distanceKm)) ? { distanceKm: Number(leg.distanceKm) } : {}),
        ...(typeof leg.instruction === 'string' ? { instruction: leg.instruction } : {}),
        ...(typeof leg.line === 'string' ? { line: leg.line } : {}),
        ...(typeof leg.fromStop === 'string' ? { fromStop: leg.fromStop } : {}),
        ...(typeof leg.toStop === 'string' ? { toStop: leg.toStop } : {}),
        ...(Number.isFinite(Number(leg.numStops)) ? { numStops: Number(leg.numStops) } : {}),
      }))
  }
  if (Array.isArray(source.polyline)) {
    const polyline = source.polyline.filter(
      (point): point is [number, number] =>
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(Number(point[0])) &&
        Number.isFinite(Number(point[1])),
    )
    if (polyline.length) result.polyline = polyline
  }
  return Object.keys(result).length ? result : null
}

export function getMedia(item: TripPlanItemView): MediaPayload | null {
  const record = payloadRecord(item)
  const media = record ? nested(record, 'media') : null
  if (!media) return null
  const displayUrl = typeof media.displayUrl === 'string' ? media.displayUrl : null
  if (!displayUrl) return null
  return {
    displayUrl,
    ...(typeof media.source === 'string' ? { source: media.source } : {}),
    ...(typeof media.attribution === 'string' ? { attribution: media.attribution } : {}),
  }
}

/** 条目是否是参与编号/地图/路线的"点"（站内点位或带坐标的外部地点） */
export function isRoutablePointItem(item: TripPlanItemView): boolean {
  if (item.type === 'point') {
    if (item.pointId) return Boolean(item.point?.lat != null && item.point?.lng != null)
    return getPlace(item) !== null
  }
  // attraction 等类型挂了带坐标的 payload.place 也按路由点处理
  return getPlace(item) !== null
}

/**
 * 时间轴计序口径（M3 修订）：type='point'（含历史缺坐标数据）以及任何带
 * payload.place 的可到访条目（外部地点的 attraction/point）都计序号——
 * 与地图编号保持一致，外部地点是完整的行程点而不是备注。
 */
export function isNumberedVisitItem(item: TripPlanItemView): boolean {
  if (item.type === 'point') return true
  if (item.type === 'transit') return false
  return getPlace(item) !== null
}

/** 地图点坐标（外部地点优先用 payload.place，站内点位用关联 point） */
export function itemLatLng(item: TripPlanItemView): { lat: number; lng: number } | null {
  const place = getPlace(item)
  if (place) return { lat: place.lat, lng: place.lng }
  if (item.point?.lat != null && item.point?.lng != null) return { lat: item.point.lat, lng: item.point.lng }
  return null
}

export function formatDistanceKm(distanceKm: number): string {
  return distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`
}

/** 交通段主文案："步行 8 分钟 · 650m"；estimated 兜底值追加"（参考估算）"标注 */
export function formatTransportText(transport: TransportPayload): string {
  const parts: string[] = []
  const modeLabel =
    transport.mode === 'walk' ? '步行' : transport.mode === 'driving' ? '自驾' : transport.mode === 'transit' ? '乘车' : null
  if (typeof transport.durationMin === 'number' && modeLabel) {
    parts.push(`${modeLabel} ${Math.round(transport.durationMin)} 分钟`)
  }
  if (typeof transport.distanceKm === 'number' && transport.distanceKm > 0) {
    parts.push(formatDistanceKm(transport.distanceKm))
  }
  const text = parts.join(' · ')
  if (transport.estimated && text) return `${text}（参考估算）`
  return text
}

/** 分段摘要："步行至京都站 → 京阪本线 5 站 → 步行 300m"；无 legs 返回 null */
export function formatLegsText(transport: TransportPayload): string | null {
  const legs = transport.legs
  if (!legs || !legs.length) return null
  const segments = legs.map((leg) => {
    if (leg.mode === 'transit' || (leg.line && (leg.fromStop || leg.toStop))) {
      const line = leg.line || '公共交通'
      const stops = typeof leg.numStops === 'number' && leg.numStops > 0 ? ` ${leg.numStops} 站` : ''
      const from = leg.fromStop ? `从${leg.fromStop}` : ''
      const to = leg.toStop ? `到${leg.toStop}` : ''
      return `${line}${stops}${from || to ? `（${from}${to}）` : ''}`.trim()
    }
    if (leg.mode === 'walk') {
      const minutes = typeof leg.durationMin === 'number' ? ` ${Math.round(leg.durationMin)} 分钟` : ''
      const distance = typeof leg.distanceKm === 'number' && leg.distanceKm > 0 ? ` · ${formatDistanceKm(leg.distanceKm)}` : ''
      return `步行${minutes}${distance}`.trim()
    }
    if (leg.mode === 'drive') {
      const minutes = typeof leg.durationMin === 'number' ? ` ${Math.round(leg.durationMin)} 分钟` : ''
      return `自驾${minutes}`.trim()
    }
    return leg.instruction?.slice(0, 40) ?? ''
  })
  const joined = segments.filter(Boolean).join(' → ')
  return joined || null
}

/** 当天主要交通模式（地图几何 mode 参数）：任一自驾段 → driving，否则 walking */
export function dayTravelMode(items: TripPlanItemView[]): 'walking' | 'driving' {
  for (const item of items) {
    const transport = getTransport(item)
    if (transport?.mode === 'driving') return 'driving'
  }
  return 'walking'
}

/** 拼接当天 transit 条目里的 provider 折线（[lat,lng] → [lng,lat]），无则空数组 */
export function collectProviderGeometry(items: TripPlanItemView[]): Array<[number, number]> {
  const coordinates: Array<[number, number]> = []
  for (const item of items) {
    const transport = getTransport(item)
    if (!transport?.polyline?.length) continue
    for (const point of transport.polyline) {
      const next: [number, number] = [point[1], point[0]]
      const last = coordinates[coordinates.length - 1]
      if (last && last[0] === next[0] && last[1] === next[1]) continue
      coordinates.push(next)
    }
  }
  return coordinates
}

/** 防御性排序：按 schedule.start 升序（无 schedule 的条目保持相对原序垫底） */
export function sortItemsBySchedule(items: TripPlanItemView[]): TripPlanItemView[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const scheduleA = getSchedule(a.item)
      const scheduleB = getSchedule(b.item)
      const minutesA = scheduleA ? scheduleStartMinutes(scheduleA) : null
      const minutesB = scheduleB ? scheduleStartMinutes(scheduleB) : null
      if (minutesA !== null && minutesB !== null) return minutesA - minutesB || a.index - b.index
      if (minutesA !== null) return -1
      if (minutesB !== null) return 1
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

// 渲染期时间兜底用的临时索引标记（用完即删，绝不进入渲染/落库载荷）
const RENDER_INDEX_KEY = '__renderIndex'

/**
 * 渲染期时间兜底（M3 修订）：历史数据（M3 之前保存，payload 无 schedule）也必须
 * 显示具体时钟时间，绝不退化成只显示"午后/傍晚"。用与服务端同一个确定性
 * 归一化器推导缺失的时间区间；已有 schedule 的条目原样保留（含 confidence
 * 标注），显式时间作为锚点参与推导。归一化失败（历史数据显式冲突等）时
 * 原样返回，不阻塞渲染——修复路径在服务端保存时显式报错。
 */
export function ensureDayScheduleForRender(items: TripPlanItemView[]): TripPlanItemView[] {
  if (!items.length || items.every((item) => getSchedule(item) !== null)) return items

  const originalByIndex = new Map<number, TripPlanItemView>()
  const inputs = items.map((item, index) => {
    originalByIndex.set(index, item)
    const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
      ? { ...(item.payload as Record<string, unknown>) }
      : {}
    payload[RENDER_INDEX_KEY] = index
    return {
      type: item.type,
      title: item.title,
      pointId: item.pointId,
      timeHint: item.timeHint,
      note: item.note,
      reason: item.reason,
      payload,
    }
  })

  const normalized = normalizeDaySchedule(inputs)
  if (!normalized.ok) return items

  const out: TripPlanItemView[] = []
  for (const normalizedItem of normalized.items) {
    const payload = { ...normalizedItem.payload }
    const index = payload[RENDER_INDEX_KEY]
    delete payload[RENDER_INDEX_KEY]
    if (typeof index !== 'number') continue
    const original = originalByIndex.get(index)
    if (!original) continue
    const originalSchedule = getSchedule(original)
    const finalPayload = originalSchedule
      ? { ...(original.payload as Record<string, unknown>), schedule: originalSchedule }
      : payload
    out.push({ ...original, payload: finalPayload as TripPlanItemView['payload'] })
  }
  // 防御：任何条目意外丢失时原样返回，绝不在渲染层丢点
  return out.length === items.length ? out : items
}
