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
 */
export function resolveDayAnchors(dayIndex: number, lodgings: LodgingLike[], places: PlaceLike[]): Anchors {
  const byPlaceId = new Map(places.map((place) => [place.id, place]))
  const coordsOf = (lodging: LodgingLike): LatLng | undefined => {
    const place = byPlaceId.get(lodging.placeId)
    return place ? { lat: place.lat, lng: place.lng } : undefined
  }

  let start: LatLng | undefined
  let end: LatLng | undefined

  for (const lodging of lodgings) {
    const isStart = lodging.toDayIndex === dayIndex || (lodging.fromDayIndex < dayIndex && dayIndex < lodging.toDayIndex)
    const isEnd = lodging.fromDayIndex === dayIndex || (lodging.fromDayIndex < dayIndex && dayIndex < lodging.toDayIndex)
    if (isStart) start = coordsOf(lodging) ?? start
    if (isEnd) end = coordsOf(lodging) ?? end
  }

  const anchors: Anchors = {}
  if (start) anchors.start = start
  if (end) anchors.end = end
  return anchors
}

export type DayAnchorStop = { placeId: string; title: string; lat: number; lng: number }

/**
 * 带住宿名与 placeId 的当天锚点（GPX/ICS 导出用），语义与 resolveDayAnchors 一致：
 * start = 今天退房/住中的酒店，end = 今天入住/住中的酒店；from==to==d 两者皆是。
 * 找不到对应 place（或 place 无标题）的锚忽略。
 */
export function resolveDayAnchorStops(
  dayIndex: number,
  lodgings: LodgingLike[],
  places: NamedPlaceLike[]
): { start?: DayAnchorStop; end?: DayAnchorStop } {
  const byPlaceId = new Map(places.map((place) => [place.id, place]))
  const stopOf = (lodging: LodgingLike): DayAnchorStop | undefined => {
    const place = byPlaceId.get(lodging.placeId)
    if (!place || !place.title) return undefined
    return { placeId: place.id, title: place.title, lat: place.lat, lng: place.lng }
  }

  let start: DayAnchorStop | undefined
  let end: DayAnchorStop | undefined
  for (const lodging of lodgings) {
    const isStart = lodging.toDayIndex === dayIndex || (lodging.fromDayIndex < dayIndex && dayIndex < lodging.toDayIndex)
    const isEnd = lodging.fromDayIndex === dayIndex || (lodging.fromDayIndex < dayIndex && dayIndex < lodging.toDayIndex)
    if (isStart) start = stopOf(lodging) ?? start
    if (isEnd) end = stopOf(lodging) ?? end
  }
  const result: { start?: DayAnchorStop; end?: DayAnchorStop } = {}
  if (start) result.start = start
  if (end) result.end = end
  return result
}
