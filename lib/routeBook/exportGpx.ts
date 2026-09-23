/**
 * GPX 1.1 导出（纯函数）：
 * - 有坐标的 point/place 条目 → `<wpt lat lon><name><desc>备注</desc><sym>kind</sym></wpt>`
 * - 每天（含住宿首尾）一条 `<rte><name>Day N</name><rtept lat lon><name/></rtept>…</rte>`；
 *   住中日（同一酒店既为 start 也为 end）也输出回酒店的终点，仅当天无任何停靠时不重复
 * - scope=day 只输出该天（wpt/rte 均限定）
 * - 文本剔除 XML 非法控制字符；转义与构建由 fast-xml-parser 承担
 */

import { XMLBuilder } from 'fast-xml-parser'
import { resolveDayAnchorStops } from '@/lib/routeBook/anchors'
import type { RouteBookDay, RouteBookItem, RouteBookLodging, RouteBookPlace } from '@/lib/routeBook/repo'

export type GpxPointPreview = { title: string; lat: number; lng: number }

export type GpxExportInput = {
  title: string
  days: RouteBookDay[]
  items: RouteBookItem[]
  places: RouteBookPlace[]
  lodgings: RouteBookLodging[]
  previews: Map<string, GpxPointPreview>
  scope: GpxExportScope
}

export type GpxExportScope = { kind: 'all' } | { kind: 'day'; dayIndex: number }

const builder = new XMLBuilder({
  format: true,
  indentBy: '  ',
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  suppressEmptyNode: true,
  processEntities: true,
})

/** XML 1.0 非法控制字符（允许的 TAB/LF/CR 除外）直接剔除 */
const XML_INVALID_CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g

function xmlSafe(value: string): string {
  return value.replace(XML_INVALID_CTRL, '')
}

function coord(n: number): string {
  return n.toFixed(6)
}

type WptNode = Record<string, unknown> & { '@_lat': string; '@_lon': string }

function wpt(node: { lat: number; lng: number; name: string; desc?: string; sym: string }): WptNode {
  return {
    '@_lat': coord(node.lat),
    '@_lon': coord(node.lng),
    name: xmlSafe(node.name),
    ...(node.desc ? { desc: xmlSafe(node.desc) } : {}),
    sym: node.sym,
  }
}

export function buildGpx(input: GpxExportInput): string {
  const { title, days, items, places, lodgings, previews, scope } = input

  const inScopeDay = (day: RouteBookDay) => scope.kind === 'all' || day.dayIndex === scope.dayIndex
  const scopedDays = days.filter(inScopeDay)
  const scopedDayIds = new Set(scopedDays.map((d) => d.id))
  const scopedItems = items.filter((item) => item.dayId === null ? scope.kind === 'all' : scopedDayIds.has(item.dayId))
  const placeById = new Map(places.map((place) => [place.id, place]))

  /** 点位/地点名缺失时退回条目标题（与 ICS 导出一致） */
  const itemTitle = (item: RouteBookItem): string | null => {
    if (item.kind === 'point' && item.pointId) {
      const preview = previews.get(item.pointId)
      return preview ? preview.title : (item.title ?? null)
    }
    if (item.kind === 'place' && item.placeId) {
      const place = placeById.get(item.placeId)
      return place ? place.title : (item.title ?? null)
    }
    return null
  }

  // ---- wpt：有坐标的 point/place（同 pointId 多天只导一次）----
  const wpts: WptNode[] = []
  const seenPointIds = new Set<string>()
  const seenPlaceIds = new Set<string>()
  for (const item of scopedItems) {
    if (item.kind === 'point' && item.pointId) {
      const preview = previews.get(item.pointId)
      if (!preview || seenPointIds.has(item.pointId)) continue
      seenPointIds.add(item.pointId)
      wpts.push(wpt({ lat: preview.lat, lng: preview.lng, name: itemTitle(item) ?? preview.title, desc: item.note ?? undefined, sym: 'point' }))
    }
    if (item.kind === 'place' && item.placeId && !seenPlaceIds.has(item.placeId)) {
      const place = placeById.get(item.placeId)
      if (!place) continue
      seenPlaceIds.add(item.placeId)
      wpts.push(wpt({ lat: place.lat, lng: place.lng, name: itemTitle(item) ?? place.title, desc: place.note ?? undefined, sym: place.kind }))
    }
  }

  // ---- rte：每天一条，住宿首尾 + 当天有坐标条目按 sortOrder ----
  const rtes: Record<string, unknown>[] = []
  const scopedPlaceIdsForRte = new Set<string>()
  for (const day of scopedDays) {
    const dayItems = items
      .filter((item) => item.dayId === day.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    const anchor = resolveDayAnchorStops(day.dayIndex, lodgings, places)
    const stops: { lat: number; lng: number; name: string }[] = []
    if (anchor.start) {
      stops.push({ lat: anchor.start.lat, lng: anchor.start.lng, name: anchor.start.title })
      scopedPlaceIdsForRte.add(anchor.start.placeId)
    }
    let hasMidStops = false
    for (const item of dayItems) {
      if (item.kind === 'point' && item.pointId) {
        const preview = previews.get(item.pointId)
        if (!preview) continue
        stops.push({ lat: preview.lat, lng: preview.lng, name: itemTitle(item) ?? preview.title })
        hasMidStops = true
      } else if (item.kind === 'place' && item.placeId) {
        const place = placeById.get(item.placeId)
        if (!place) continue
        stops.push({ lat: place.lat, lng: place.lng, name: itemTitle(item) ?? place.title })
        scopedPlaceIdsForRte.add(place.id)
        hasMidStops = true
      }
    }
    // 住中日（start 与 end 同一酒店）也要输出回酒店的终点；仅当天没有任何停靠时避免连续重复
    const sameLodgingBothEnds =
      anchor.start !== undefined && anchor.end !== undefined && anchor.start.placeId === anchor.end.placeId
    if (anchor.end && !(sameLodgingBothEnds && !hasMidStops)) {
      stops.push({ lat: anchor.end.lat, lng: anchor.end.lng, name: anchor.end.title })
      scopedPlaceIdsForRte.add(anchor.end.placeId)
    }

    // 住宿锚点不在 wpt 里时补一条（sym=lodging）
    for (const placeId of scopedPlaceIdsForRte) {
      if (seenPlaceIds.has(placeId)) continue
      const place = placeById.get(placeId)
      if (!place) continue
      seenPlaceIds.add(placeId)
      wpts.push(wpt({ lat: place.lat, lng: place.lng, name: place.title, desc: place.note ?? undefined, sym: place.kind }))
    }

    if (stops.length === 0) continue
    rtes.push({
      name: `Day ${day.dayIndex}`,
      rtept: stops.map((stop) => ({
        '@_lat': coord(stop.lat),
        '@_lon': coord(stop.lng),
        name: xmlSafe(stop.name),
      })),
    })
  }

  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    gpx: {
      '@_version': '1.1',
      '@_creator': 'SeichiGo',
      '@_xmlns': 'http://www.topografix.com/GPX/1/1',
      metadata: { name: xmlSafe(title) },
      ...(wpts.length > 0 ? { wpt: wpts } : {}),
      ...(rtes.length > 0 ? { rte: rtes } : {}),
    },
  }
  return `${builder.build(doc)}\n`
}
