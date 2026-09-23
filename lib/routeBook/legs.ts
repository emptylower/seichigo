import type { Prisma } from '@prisma/client'
import { computeHeuristicTransitCore } from '@/lib/planAgent/enrich/heuristicTransit'
import { resolveDayAnchors } from './anchors'
import { readTransitBetween } from './rules'
import { haversineM, type LatLng } from './optimize'
import type { RouteBookDay, RouteBookItem, RouteBookLodging, RouteBookPlace, TravelMode } from './repo'

export type LegSource = 'google' | 'agent' | 'heuristic'

export type Leg = {
  fromId: string
  toId: string
  mode: TravelMode
  durationSec: number
  distanceM: number
  polyline: [number, number][] | null
  source: LegSource
}

export type LegStop = { id: string; lat: number; lng: number; legMode: TravelMode | null }

export const LODGING_START_STOP_ID = 'lodging:start'
export const LODGING_END_STOP_ID = 'lodging:end'

type DayItemInput = Pick<RouteBookItem, 'id' | 'dayId' | 'sortOrder' | 'kind' | 'pointId' | 'placeId' | 'legMode' | 'payload'>

type AgentTransport = { mode?: unknown; durationMin?: unknown; distanceKm?: unknown }

function agentModeToTravelMode(mode: unknown): TravelMode {
  if (mode === 'walk') return 'walking'
  if (mode === 'transit') return 'transit'
  return 'driving'
}

function readTransport(payload: Prisma.JsonValue | null): AgentTransport | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const transport = (payload as Record<string, unknown>).transport
  if (transport === null || typeof transport !== 'object' || Array.isArray(transport)) return null
  return transport as AgentTransport
}

/**
 * 组装当天停靠序列：住宿首尾按 resolveDayAnchors 规则（id 用 lodging:start / lodging:end），
 * 中间是有坐标的 point/place 条目；transit 条目不进序列——只有当它
 * payload.transitBetween.prevItemId 是它前一站、nextItemId 是后一站时，
 * 才把 payload.transport 登记到 agentLegs（key = nextItemId）；否则记入 staleTransitItemIds。
 * B2 修复 A3：后一站显式设置 legMode 时该段永远按 legMode 计算，agent transit 条目
 * 不登记并直接进 staleTransitItemIds。
 */
export function buildDayStops(
  day: Pick<RouteBookDay, 'id' | 'dayIndex'>,
  items: DayItemInput[],
  places: Pick<RouteBookPlace, 'id' | 'lat' | 'lng'>[],
  lodgings: Pick<RouteBookLodging, 'placeId' | 'fromDayIndex' | 'toDayIndex'>[],
  pointCoords: Map<string, LatLng>
): { stops: LegStop[]; agentLegs: Map<string, Prisma.JsonValue>; staleTransitItemIds: string[] } {
  const coordsByPlaceId = new Map(places.map((place) => [place.id, { lat: place.lat, lng: place.lng }]))

  const dayItems = items
    .filter((item) => item.dayId === day.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const coordsOf = (item: DayItemInput): LatLng | null => {
    if (item.kind === 'point' && item.pointId) return pointCoords.get(item.pointId) ?? null
    if (item.kind === 'place' && item.placeId) return coordsByPlaceId.get(item.placeId) ?? null
    return null
  }

  // 第一遍：确定哪些条目会成为停靠点（有坐标的 point/place）
  const stopIndexes: number[] = []
  dayItems.forEach((item, index) => {
    if ((item.kind === 'point' || item.kind === 'place') && coordsOf(item)) stopIndexes.push(index)
  })
  const stopIdByIndex = new Map(stopIndexes.map((index) => [index, dayItems[index]!.id]))

  // B2 修复 A3：显式设置 legMode 的停靠点——指向它的 agent transit 段一律失效
  const explicitModeStopIds = new Set(
    stopIndexes.filter((index) => dayItems[index]!.legMode != null).map((index) => dayItems[index]!.id)
  )

  const anchors = resolveDayAnchors(day.dayIndex, lodgings, places)
  const stops: LegStop[] = []
  if (anchors.start) stops.push({ id: LODGING_START_STOP_ID, lat: anchors.start.lat, lng: anchors.start.lng, legMode: null })

  const agentLegs = new Map<string, Prisma.JsonValue>()
  const staleTransitItemIds: string[] = []

  dayItems.forEach((item, index) => {
    if (item.kind === 'note') return

    if (item.kind === 'transit') {
      const between = readTransitBetween(item.payload)
      if (!between) {
        staleTransitItemIds.push(item.id)
        return
      }
      const transport = readTransport(item.payload)
      if (!transport) return
      const prevId = nearestStopId(stopIndexes, stopIdByIndex, index, 'prev')
      const nextId = nearestStopId(stopIndexes, stopIdByIndex, index, 'next')
      if (prevId === between.prevItemId && nextId === between.nextItemId) {
        if (nextId !== null && explicitModeStopIds.has(nextId)) {
          // B2 修复 A3：后一站显式 legMode 覆盖该段 → agent transit 条目失效
          staleTransitItemIds.push(item.id)
        } else {
          agentLegs.set(between.nextItemId, transport as Prisma.JsonValue)
        }
      } else {
        staleTransitItemIds.push(item.id)
      }
      return
    }

    const coords = coordsOf(item)
    if (!coords) return
    stops.push({ id: item.id, lat: coords.lat, lng: coords.lng, legMode: item.legMode ?? null })
  })

  if (anchors.end) stops.push({ id: LODGING_END_STOP_ID, lat: anchors.end.lat, lng: anchors.end.lng, legMode: null })

  return { stops, agentLegs, staleTransitItemIds }
}

function nearestStopId(
  stopIndexes: number[],
  stopIdByIndex: Map<number, string>,
  fromIndex: number,
  direction: 'prev' | 'next'
): string | null {
  if (direction === 'prev') {
    for (let i = stopIndexes.length - 1; i >= 0; i--) {
      if (stopIndexes[i]! < fromIndex) return stopIdByIndex.get(stopIndexes[i]!) ?? null
    }
    return null
  }
  for (let i = 0; i < stopIndexes.length; i++) {
    if (stopIndexes[i]! > fromIndex) return stopIdByIndex.get(stopIndexes[i]!) ?? null
  }
  return null
}

/** 段解析器调用选项（B2 修复 A4：池已批量读缓存时可跳过逐段读） */
export type LegResolverCallOptions = { skipCacheRead?: boolean }

export type LegResolver = (
  from: LatLng,
  to: LatLng,
  mode: TravelMode,
  opts?: LegResolverCallOptions
) => Promise<Omit<Leg, 'fromId' | 'toId' | 'mode'> | null>

/** 相邻停靠对（B2 修复：显式 legMode 的段覆盖 agent 数据，mode 永远按 legMode 算） */
export type LegPair = {
  from: LegStop
  to: LegStop
  mode: TravelMode
  /** to.legMode 显式设置 */
  explicit: boolean
  /** agent transit 条目提供的载荷（显式 legMode 时为 null） */
  transport: Prisma.JsonValue | null
}

export function computeLegPairs(
  stops: LegStop[],
  agentLegs: Map<string, Prisma.JsonValue>,
  defaultMode: TravelMode
): LegPair[] {
  return stops.slice(0, -1).map((from, index) => {
    const to = stops[index + 1]!
    const explicit = to.legMode != null
    return {
      from,
      to,
      explicit,
      mode: to.legMode ?? defaultMode,
      transport: explicit ? null : agentLegs.get(to.id) ?? null,
    }
  })
}

/** 直线估算（分钟 floors 与 computeHeuristicTransitCore 同源）：walking 4.5km/h（至少
 *  3 分钟）、transit 25km/h + 12 分钟换乘（至少 10 分钟）、driving 30km/h（至少 5 分钟）。 */
function estimateByMode(from: LatLng, to: LatLng, mode: TravelMode): { durationSec: number; distanceM: number } {
  const distanceM = haversineM(from, to)
  const km = distanceM / 1000
  if (mode === 'walking') {
    return { durationSec: Math.max(3 * 60, Math.round((km / 4.5) * 3600)), distanceM: Math.round(distanceM) }
  }
  if (mode === 'transit') {
    return { durationSec: Math.max(10 * 60, Math.round((km / 25) * 3600) + 12 * 60), distanceM: Math.round(distanceM) }
  }
  return { durationSec: Math.max(5 * 60, Math.round((km / 30) * 3600)), distanceM: Math.round(distanceM) }
}

function agentLeg(transport: AgentTransport): Omit<Leg, 'fromId' | 'toId' | 'mode'> & { mode: TravelMode } {
  return {
    mode: agentModeToTravelMode(transport.mode),
    durationSec: agentDuration(transport),
    distanceM: agentDistance(transport),
    polyline: null,
    source: 'agent',
  }
}

function agentDuration(transport: AgentTransport): number {
  const minutes = typeof transport.durationMin === 'number' ? transport.durationMin : 0
  return Math.round(minutes * 60)
}

function agentDistance(transport: AgentTransport): number {
  const km = typeof transport.distanceKm === 'number' ? transport.distanceKm : 0
  return Math.round(km * 1000)
}

/** 相邻停靠两两成段：显式 legMode（B2 修复 A2/A3）> agent 数据 > resolver（B2 接 Google）
 *  > 直线估算。显式 legMode 的段永远按该 mode 计算（覆盖 agent、启发式不改写 mode），
 *  估算只补时长。非段间互不依赖，resolver 调用并发发出（handler 侧的池负责并发上限与截止）。 */
export async function resolveDayLegs(
  stops: LegStop[],
  agentLegs: Map<string, Prisma.JsonValue>,
  defaultMode: TravelMode,
  resolver: LegResolver
): Promise<Leg[]> {
  const pairs = computeLegPairs(stops, agentLegs, defaultMode)

  return Promise.all(
    pairs.map(async ({ from, to, transport, mode, explicit }) => {
      if (transport) {
        return { ...agentLeg(readTransportShape(transport)), fromId: from.id, toId: to.id }
      }

      const resolved = await resolver(from, to, mode)
      if (resolved) {
        return { ...resolved, fromId: from.id, toId: to.id, mode }
      }

      if (mode === 'driving' || explicit) {
        // B2 修复 A2：显式 legMode 只估时长，mode 保持调用方指定值
        return { ...estimateByMode(from, to, mode), polyline: null, source: 'heuristic', fromId: from.id, toId: to.id, mode }
      }
      // walking / transit 都用直线推算，mode 以估算结果为准（≤1.5km 步行，否则公交）
      const core = computeHeuristicTransitCore(from, to)
      const leg: Leg = {
        mode: core.mode === 'walk' ? 'walking' : 'transit',
        durationSec: core.durationMin * 60,
        distanceM: Math.round(core.distanceKm * 1000),
        polyline: null,
        source: 'heuristic',
        fromId: from.id,
        toId: to.id,
      }
      return leg
    })
  )
}

function readTransportShape(value: Prisma.JsonValue): AgentTransport {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as AgentTransport
}
