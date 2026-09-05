import {
  buildPlacePhotoDisplayUrl,
  isSafePlacePhotoDisplayUrl,
  type PlacePhotoRef,
} from '@/lib/googlePlaces/places'
import type { EnrichContext, EnrichDay, EnrichReport } from './types'

/**
 * 计划内图片去重（回归第四轮 A4）：同一 Google 地点被多条条目解析到时
 * （「机场前往新宿」「新宿街头散步」「住宿新宿」都指向新宿站），地点库每个
 * 地点原先只存一张照片，导致多条卡片同图。这里在 media 派生之后、邻近图
 * 兜底之前，把重复使用的地点照片按序号错开（displayUrl 追加 &i=<n>）：
 * - 图片键 imageKeyOf：place-photo URL → google:<placeId>:<i>（忽略 maxwidth；
 *   ref 形式用 googleref:<ref>）；其他 URL → 去掉 query 的 URL 字符串。
 * - 站内点位图与 source=neighbor 的条目只登记键，不改（站内图没有第二张）。
 * - Google 图键冲突时从该地点已知照片（地点库 photos，必要时经
 *   fetchPlacePhotos 补拉一次并回写）里找第一个未用过的序号。
 * - 该地点只有一张照片 → 保持重复并记 skipped。
 * 幂等：条目已带 photoIndex 且键未被更早条目占用时原样保留。
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 计划内图片去重键：place-photo URL 折叠成 placeId+序号（ref 形式单独键），其他 URL 去掉 query；非站内相对路径带 origin（R9：不同 host 同路径不相等） */
export function imageKeyOf(displayUrl: string): string {
  const value = String(displayUrl || '').trim()
  if (!value) return ''
  try {
    const url = new URL(value, 'https://plan-image.invalid')
    if (url.origin === 'https://plan-image.invalid' && url.pathname === '/api/google/place-photo') {
      const placeId = url.searchParams.get('placeId') ?? ''
      const ref = url.searchParams.get('ref') ?? ''
      if (placeId) return `google:${placeId}:${url.searchParams.get('i') ?? '0'}`
      if (ref) return `googleref:${ref}`
      return url.pathname
    }
    return url.origin === 'https://plan-image.invalid' ? url.pathname : `${url.origin}${url.pathname}`
  } catch {
    return value
  }
}

/** 条目自身图：payload.media.displayUrl 优先，否则站内点位 image */
export function ownImageOf(item: EnrichDay['items'][number], ctx: EnrichContext): string | null {
  const media = asRecord(item.payload?.media)
  if (typeof media?.displayUrl === 'string' && media.displayUrl) return media.displayUrl
  if (item.pointId) {
    const coord = ctx.coordsByPointId.get(item.pointId)
    if (typeof coord?.image === 'string' && coord.image) return coord.image
  }
  return null
}

/** 汇总当前已占用的图片键（neighbor 兜底与去重共用同一口径） */
export function collectUsedImageKeys(days: EnrichDay[], ctx: EnrichContext): Set<string> {
  const used = new Set<string>()
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'transit') continue
      const own = ownImageOf(item, ctx)
      if (own) used.add(imageKeyOf(own))
    }
  }
  return used
}

function placePhotosOf(item: EnrichDay['items'][number], ctx: EnrichContext): PlacePhotoRef[] {
  const place = asRecord(item.payload?.place)
  const rawPhotos = Array.isArray(place?.photos) ? place.photos : []
  const photos: PlacePhotoRef[] = []
  for (const entry of rawPhotos) {
    const record = asRecord(entry)
    const photoReference = typeof record?.photoReference === 'string' ? record.photoReference : ''
    if (photoReference) photos.push({ photoReference, attribution: typeof record?.attribution === 'string' ? record.attribution : null })
  }
  return photos
}

/** 取该地点的已知照片：地点库 photos 优先；库不可用则退回 payload.place.photos */
async function knownPhotosOf(
  placeId: string,
  item: EnrichDay['items'][number],
  ctx: EnrichContext,
): Promise<{ photos: PlacePhotoRef[]; fromStore: boolean }> {
  if (ctx.deps.externalPlaces) {
    try {
      const record = await ctx.deps.externalPlaces.findByPlaceId('google', placeId)
      if (record) return { photos: record.photos ?? [], fromStore: true }
    } catch {
      // 库不可用：静默降级到条目内 photos
    }
  }
  return { photos: placePhotosOf(item, ctx), fromStore: false }
}

export async function runImageDedupeEnricher(days: EnrichDay[], ctx: EnrichContext, report: EnrichReport): Promise<void> {
  // 键按天序、条目序就地登记（先到先得）：第一次出现的原图保留，后面的重复才改写
  const used = new Set<string>()
  // R5：同一 placeId 的 fetchPlacePhotos 每次运行只补拉一次（无论成功与否）
  const attemptedPlaceIds = new Set<string>()
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'transit') continue
      const media = asRecord(item.payload?.media)
      const displayUrl = typeof media?.displayUrl === 'string' ? media.displayUrl : ''
      if (!displayUrl) continue // 自身无图（站内点位图也没有）：交给 neighbor 兜底
      const key = imageKeyOf(displayUrl)
      // 站内图 / neighbor 借图 / 非 Google 图：只登记，不改
      const isNeighbor = media?.source === 'neighbor'
      const place = asRecord(item.payload?.place)
      const placeId = typeof place?.placeId === 'string' ? place.placeId : ''
      const isGooglePhoto = isSafePlacePhotoDisplayUrl(displayUrl) && Boolean(placeId) && key.startsWith('google:')
      if (!isGooglePhoto || isNeighbor) {
        used.add(key)
        continue
      }
      if (!used.has(key)) {
        used.add(key)
        continue
      }
      // 键已被更早的条目占用：从 index 1 起找第一个未登记的序号
      let photos = (await knownPhotosOf(placeId, item, ctx)).photos
      if (
        photos.length <= 1 &&
        !attemptedPlaceIds.has(placeId) &&
        ctx.deps.fetchPlacePhotos &&
        ctx.budget &&
        ctx.budget.places.used < ctx.budget.places.max
      ) {
        attemptedPlaceIds.add(placeId)
        const fetched = await ctx.deps.fetchPlacePhotos({
          placeId,
          onGoogleCall: () => {
            if (ctx.budget) ctx.budget.places.used += 1
          },
        })
        if (fetched && fetched.length > 0) {
          photos = fetched
          if (ctx.deps.externalPlaces) {
            await ctx.deps.externalPlaces.updatePhotos('google', placeId, photos).catch(() => undefined)
          }
        }
      }
      const next = photos.findIndex((_, index) => index >= 1 && !used.has(`google:${placeId}:${index}`))
      const n = next >= 1 ? next : -1
      if (n < 1 || !photos[n]) {
        report.skipped.push({ enricher: 'dedupe', itemTitle: item.title, reason: '该地点只有一张照片' })
        continue
      }
      if (!item.payload) item.payload = {}
      const attribution = photos[n].attribution
      const nextMedia: Record<string, unknown> = { ...media, displayUrl: buildPlacePhotoDisplayUrl({ placeId, index: n }), photoIndex: n }
      if (attribution) nextMedia.attribution = attribution
      else delete nextMedia.attribution
      item.payload.media = nextMedia
      used.add(`google:${placeId}:${n}`)
      report.applied.dedupe += 1
    }
  }
}
