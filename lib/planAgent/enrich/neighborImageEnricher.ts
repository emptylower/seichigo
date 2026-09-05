import { buildPlacePhotoDisplayUrl, isSafePlacePhotoDisplayUrl, type PlacePhotoRef } from '@/lib/googlePlaces/places'
import { collectUsedImageKeys, imageKeyOf, ownImageOf } from './imageDedupeEnricher'
import type { EnrichContext, EnrichDay, EnrichReport } from './types'

/**
 * 邻近图兜底（回归第三轮 A3 / 第四轮 A4 修订）：place 解析失败/不可用时，
 * 「自由安排」「参考建议」这类条目没有任何图，DayCards 只能渲染灰色占位。
 * 这里给任何非 transit 且自身无图（payload.media 与站内点位 image 都没有）
 * 的条目借邻近条目的图：同一天前一个有图条目 → 后一个有图条目 → 前一天
 * 最后一个有图条目；都没有跳过（宁缺毋滥，绝不编造外部 URL）。
 *
 * A4 修订：
 * - 午餐/晚餐 meal 条目绝不借图（餐厅必须有自己的 Google 照片，见 A6）；
 * - 候选先展开成"该候选的可用图列表"——候选有 Google 图且已知照片 > 1 张
 *   （payload.place.photos 或地点库）时展开为各序号 URL，否则就它自己那张；
 *   从近到远、按展开顺序选第一个键不在去重集合里的图（同一天多个无图条目
 *   不会都借同一张）；全都用过了才退回最近候选的原图（原行为）。
 *
 * 写入 payload.media = { source: 'neighbor', displayUrl, attribution?: 来源条目标题 }，
 * 前端对 source=neighbor 加"参考"角标。幂等：已有 media / 自身站内图的条目不动。
 */

type NeighborImage = { displayUrl: string; attribution?: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 午餐/晚餐 meal 条目：餐厅不借图（A4/A6） */
function isMealNeverBorrow(item: EnrichDay['items'][number]): boolean {
  if (item.type !== 'meal') return false
  const slot = (item.payload ?? {}).mealSlot
  return slot === 'lunch' || slot === 'dinner'
}

function photosOfPlace(place: Record<string, unknown> | null): PlacePhotoRef[] {
  const rawPhotos = Array.isArray(place?.photos) ? place.photos : []
  const photos: PlacePhotoRef[] = []
  for (const entry of rawPhotos) {
    const record = asRecord(entry)
    const photoReference = typeof record?.photoReference === 'string' ? record.photoReference : ''
    if (photoReference) photos.push({ photoReference, attribution: typeof record?.attribution === 'string' ? record.attribution : null })
  }
  return photos
}

/**
 * 把一个候选展开成可用图列表：Google 图且已知照片 > 1 张（payload.place.photos
 * 优先，否则地点库）→ 各序号 URL；否则就它自己那张。
 * photosByPlaceId 是本次运行内的库查询备忘录（R8：同一 placeId 只查一次库，
 * 消除多个无图条目共用同一候选时的 N+1）。
 */
async function expandCandidateImages(
  item: EnrichDay['items'][number],
  ctx: EnrichContext,
  photosByPlaceId: Map<string, PlacePhotoRef[]>,
): Promise<NeighborImage[]> {
  const own = ownImageOf(item, ctx)
  if (!own) return []
  if (isSafePlacePhotoDisplayUrl(own)) {
    const place = asRecord(item.payload?.place)
    const placeId = typeof place?.placeId === 'string' ? place.placeId : ''
    if (placeId && imageKeyOf(own).startsWith(`google:${placeId}:`)) {
      let photos = photosOfPlace(place)
      if (photos.length <= 1 && ctx.deps.externalPlaces) {
        if (!photosByPlaceId.has(placeId)) {
          try {
            const record = await ctx.deps.externalPlaces.findByPlaceId('google', placeId)
            photosByPlaceId.set(placeId, record?.photos ?? [])
          } catch {
            // 库不可用：静默按单张处理
            photosByPlaceId.set(placeId, [])
          }
        }
        photos = photosByPlaceId.get(placeId) ?? []
      }
      if (photos.length > 1) {
        return photos.map((_, index) => ({
          displayUrl: buildPlacePhotoDisplayUrl({ placeId, index }),
          attribution: item.title,
        }))
      }
    }
  }
  return [{ displayUrl: own, attribution: item.title }]
}

/** 候选来源条目顺序：当天前一个 → 当天后一个 → 前一天最后一个（从近到远） */
function candidateItems(days: EnrichDay[], dayPosition: number, itemIndex: number, ctx: EnrichContext): EnrichDay['items'][number][] {
  const day = days[dayPosition]
  const candidates: EnrichDay['items'][number][] = []
  const pushIfHasImage = (item: EnrichDay['items'][number]) => {
    if (ownImageOf(item, ctx)) candidates.push(item)
  }
  for (let i = itemIndex - 1; i >= 0; i--) pushIfHasImage(day.items[i])
  for (let i = itemIndex + 1; i < day.items.length; i++) pushIfHasImage(day.items[i])
  for (let d = dayPosition - 1; d >= 0; d--) {
    for (let i = days[d].items.length - 1; i >= 0; i--) pushIfHasImage(days[d].items[i])
  }
  return candidates
}

export async function runNeighborImageEnricher(days: EnrichDay[], ctx: EnrichContext, report: EnrichReport): Promise<void> {
  // 与去重共用同一口径的已用键集合：选定后就地登记，同一天多个无图条目不会都借同一张
  const used = collectUsedImageKeys(days, ctx)
  // R8：库查询备忘录——同一 placeId 只查一次（多个无图条目共用同一候选时消除 N+1）
  const photosByPlaceId = new Map<string, PlacePhotoRef[]>()
  for (let dayPosition = 0; dayPosition < days.length; dayPosition++) {
    const day = days[dayPosition]
    for (let itemIndex = 0; itemIndex < day.items.length; itemIndex++) {
      const item = day.items[itemIndex]
      if (item.type === 'transit') continue
      if (isMealNeverBorrow(item)) continue
      if (ownImageOf(item, ctx)) continue
      let assigned: NeighborImage | null = null
      let nearestOriginal: NeighborImage | null = null
      for (const candidate of candidateItems(days, dayPosition, itemIndex, ctx)) {
        const expanded = await expandCandidateImages(candidate, ctx, photosByPlaceId)
        if (expanded.length && !nearestOriginal) nearestOriginal = expanded[0]
        for (const image of expanded) {
          if (!used.has(imageKeyOf(image.displayUrl))) {
            assigned = image
            break
          }
        }
        if (assigned) break
      }
      // 全都用过了才退回最近候选的原图（原行为）
      const neighbor = assigned ?? nearestOriginal
      if (!neighbor) continue
      if (!item.payload) item.payload = {}
      item.payload.media = {
        source: 'neighbor',
        displayUrl: neighbor.displayUrl,
        ...(neighbor.attribution ? { attribution: neighbor.attribution } : {}),
      }
      used.add(imageKeyOf(neighbor.displayUrl))
      report.applied.neighbor += 1
    }
  }
}
