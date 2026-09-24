import type { Anchors, LatLng } from './optimize'

type LodgingLike = { placeId: string; fromDayIndex: number; toDayIndex: number }
type PlaceLike = { id: string; lat: number; lng: number }
type NamedPlaceLike = { id: string; title?: string | null; lat: number; lng: number }

/**
 * 当天的住宿锚点：
 * - start：今天退房（to == d）或住中（from < d < to）的酒店——早上从它出发
 * - end：今天入住（from == d）或住中（from < d < to）的酒店——晚上回到它
 * - from == to == d：当天不过夜但以此为锚，同时作为 start 与 end
 * 换酒店日 start/end 来自不同 lodging。坐标取 places 里对应 placeId；找不到 place 的锚忽略。
 *
 * 匹配逻辑统一在 matchDayLodgings，resolveDayAnchors（坐标）与
 * resolveDayAnchorStops（含 placeId/名称，导出用）都从它派生。
 */
function matchDayLodgings(dayIndex: number, lodgings: LodgingLike[]): { start?: LodgingLike; end?: LodgingLike } {
  let start: LodgingLike | undefined
  let end: LodgingLike | undefined
  for (const lodging of lodgings) {
    const isStart = lodging.toDayIndex === dayIndex || (lodging.fromDayIndex < dayIndex && dayIndex < lodging.toDayIndex)
    const isEnd = lodging.fromDayIndex === dayIndex || (lodging.fromDayIndex < dayIndex && dayIndex < lodging.toDayIndex)
    if (isStart && start === undefined) start = lodging
    if (isEnd && end === undefined) end = lodging
  }
  return { start, end }
}

export function resolveDayAnchors(dayIndex: number, lodgings: LodgingLike[], places: PlaceLike[]): Anchors {
  const byPlaceId = new Map(places.map((place) => [place.id, place]))
  const coordsOf = (lodging: LodgingLike): LatLng | undefined => {
    const place = byPlaceId.get(lodging.placeId)
    return place ? { lat: place.lat, lng: place.lng } : undefined
  }

  const { start, end } = matchDayLodgings(dayIndex, lodgings)
  const anchors: Anchors = {}
  const startCoords = start ? coordsOf(start) : undefined
  const endCoords = end ? coordsOf(end) : undefined
  if (startCoords) anchors.start = startCoords
  if (endCoords) anchors.end = endCoords
  return anchors
}

export type DayAnchorStop = { placeId: string; title: string; lat: number; lng: number }

/**
 * 带住宿名与 placeId 的当天锚点（GPX/ICS 导出用），语义与 resolveDayAnchors 一致：
 * start = 今天退房/住中的酒店，end = 今天入住/住中的酒店；from==to==d 两者皆是。
 * 找不到对应 place 的锚忽略；place 无标题时用默认名「住宿」。
 */
export function resolveDayAnchorStops(
  dayIndex: number,
  lodgings: LodgingLike[],
  places: NamedPlaceLike[]
): { start?: DayAnchorStop; end?: DayAnchorStop } {
  const byPlaceId = new Map(places.map((place) => [place.id, place]))
  const stopOf = (lodging: LodgingLike): DayAnchorStop | undefined => {
    const place = byPlaceId.get(lodging.placeId)
    if (!place) return undefined
    const title = place.title?.trim() ? place.title.trim() : '住宿'
    return { placeId: place.id, title, lat: place.lat, lng: place.lng }
  }

  const { start, end } = matchDayLodgings(dayIndex, lodgings)
  const result: { start?: DayAnchorStop; end?: DayAnchorStop } = {}
  const startStop = start ? stopOf(start) : undefined
  const endStop = end ? stopOf(end) : undefined
  if (startStop) result.start = startStop
  if (endStop) result.end = endStop
  return result
}
