import { derivePlaceMedia } from '../travelHelpers'
import { buildPlacePhotoDisplayUrl, isValidPlaceId } from '@/lib/googlePlaces/places'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'
import type { EnrichContext, EnrichDay, EnrichReport } from './types'

/**
 * media enricher：对有 place 无 media 的条目调 derivePlaceMedia（place.photo
 * 的站内代理 URL 派生，安全校验在内部）。落库前的同名防线保留，这里提前
 * 执行并计数，让报告与质量卡的图片统计反映补齐后的状态。幂等。
 *
 * 回归第三轮 A2：模型常把 resolve_place / find_restaurants 返回的 place
 * 裁剪成只剩 placeId/name/lat/lng 再照抄（餐厅条目尤甚），photo 丢失导致
 * 无图。这里先经 ctx 注入的 ExternalPlaceStore 按 placeId 回查，把
 * place.photo 补回来（displayUrl 用 placeId 寻址形式），再派生 media；
 * 库里也没有 photoReference 时跳过（交给 A3 邻近图兜底）。
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** place 有 placeId 但无合法 photo 时，从地点库回填 photo（原地改写） */
async function backfillPlacePhoto(place: Record<string, unknown>, store: ExternalPlaceStore): Promise<void> {
  const photo = asRecord(place.photo)
  if (photo) return
  const placeId = typeof place.placeId === 'string' ? place.placeId : ''
  if (!isValidPlaceId(placeId)) return
  let record: Awaited<ReturnType<ExternalPlaceStore['findByPlaceId']>> = null
  try {
    record = await store.findByPlaceId('google', placeId)
  } catch {
    return // 库不可用：静默降级，不打断保存
  }
  const photoReference = typeof record?.photo?.photoReference === 'string' ? record.photo.photoReference : ''
  if (!photoReference) return
  place.photo = {
    photoReference,
    displayUrl: buildPlacePhotoDisplayUrl({ placeId }),
    attribution: record?.photo?.attribution ?? null,
  }
}

export async function runMediaEnricher(days: EnrichDay[], ctx: EnrichContext, report: EnrichReport): Promise<void> {
  const store = ctx.deps.externalPlaces
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'transit') continue
      const place = asRecord(item.payload?.place)
      if (!place) continue
      if (store) await backfillPlacePhoto(place, store)
      const hadMedia = Boolean(item.payload?.media)
      derivePlaceMedia(item.payload as Record<string, unknown>, item.type)
      if (!hadMedia && item.payload?.media) report.applied.media += 1
    }
  }
}
