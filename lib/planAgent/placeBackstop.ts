import { haversineKm } from './cluster'
import { extractPlaceQuery } from './placeQuery'
import { normalizePlaceQuery, validateExternalPlacePayload, type PlaceResolver, type ResolvedPlace } from '@/lib/googlePlaces/places'
import { placesRemaining, type EnrichBudget } from './enrich/types'

/**
 * save_plan_days 的服务端兜底（设计 §5.5）：模型经常把非作品停留点写成
 * lodging/meal/attraction/free（或无 pointId 的 point）且不带 payload.place，
 * 导致 DayCards 只能渲染图片占位。这里在出处/形状校验之前，用
 * placeQuery ?? 剥饰后的标题 自动解析（库优先、Google 兜底），带当天坐标质心
 * 偏置与距离守卫，预算受限；任何失败只记录 skipped，绝不让保存失败。
 * 回归第三轮 A1：free（参考类条目）也参与解析；查询词经 extractPlaceQuery
 * 剥修饰词（「泊宿参考：难波」→ 难波、「京都站到关西机场」→ 关西机场），
 * 剥完为空（归一化后 < 2 字）才跳过——原 VAGUE 整词跳过规则废除。
 * 回归第四轮 A6：预算判定改为 placesRemaining（扣除餐厅补齐预留），
 * 保证餐厅 enricher 在地点解析之后仍有点数可用。
 * 回归第四轮审查 R2：mealSlot 为 lunch/dinner 的 meal 条目不再是兜底候选
 * （留给 restaurantEnricher 按坐标搜真餐厅，dayHasBackfillCandidate 同步）。
 */

const DEFAULT_MAX_GOOGLE_CALLS = 6
const NEAR_RADIUS_M = 30_000
const MAX_DISTANCE_FROM_CENTROID_KM = 50

export type BackfillDayInput = {
  dayIndex: number
  items: Array<{
    type: string
    pointId?: string | null
    title: string
    payload?: Record<string, unknown> | null
  }>
}

export type BackfillResult = {
  resolved: number
  skipped: Array<{ title: string; reason: string }>
}

/** 当天已知坐标的质心（平均值）；无坐标返回 null（不做偏置与距离守卫） */
function centroidOf(coords: Array<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  if (!coords.length) return null
  const sum = coords.reduce((acc, c) => ({ lat: acc.lat + c.lat, lng: acc.lng + c.lng }), { lat: 0, lng: 0 })
  return { lat: sum.lat / coords.length, lng: sum.lng / coords.length }
}

function isBackfillCandidate(item: BackfillDayInput['items'][number]): boolean {
  // R4 审查修复（R2）：lunch/dinner 的 meal 留给 restaurantEnricher（按坐标搜
  // 真餐厅）——Text Search 会把「午餐」解析成垃圾地点，还烧掉餐厅预留配额
  if (item.type === 'meal') {
    const slot = item.payload?.mealSlot
    if (slot === 'lunch' || slot === 'dinner') return false
  }
  if (item.type === 'lodging' || item.type === 'meal' || item.type === 'attraction' || item.type === 'free') {
    return validateExternalPlacePayload(item.payload?.place) !== null
  }
  if (item.type === 'point' && !item.pointId) {
    return validateExternalPlacePayload(item.payload?.place) !== null
  }
  return false
}

/** 当天是否存在需要兜底解析的条目：save_plan_days 用它跳过无候选天的质心查库 */
export function dayHasBackfillCandidate(items: BackfillDayInput['items']): boolean {
  return items.some((item) => isBackfillCandidate(item))
}

export async function backfillExternalPlaces(input: {
  days: BackfillDayInput[]
  places?: PlaceResolver
  /** 当天已知坐标（Anitabi 点 + 已有 payload.place），用于质心偏置与距离守卫 */
  dayCoordinates: (dayIndex: number) => Array<{ lat: number; lng: number }>
  maxGoogleCalls?: number
  /**
   * 共享 Google 调用预算（M4 enrich 层）：传入后忽略 maxGoogleCalls，改为
   * 读写 budget.places（Places API 分桶，引用传递、原地累加），让 place
   * enricher 与餐厅 enricher 在同一次保存里分食同一份配额。
   */
  budget?: EnrichBudget
}): Promise<BackfillResult> {
  const maxGoogleCalls = input.budget ? input.budget.places.max : (input.maxGoogleCalls ?? DEFAULT_MAX_GOOGLE_CALLS)
  const skipped: BackfillResult['skipped'] = []
  let resolved = 0
  let googleCallsUsed = 0
  const budgetExhausted = () => (input.budget ? placesRemaining(input.budget) <= 0 : googleCallsUsed >= maxGoogleCalls)
  const countGoogleCall = () => {
    if (input.budget) input.budget.places.used += 1
    else googleCallsUsed += 1
  }

  for (const day of input.days) {
    const centroid = centroidOf(input.dayCoordinates(day.dayIndex))
    for (const item of day.items) {
      if (!isBackfillCandidate(item)) continue
      // A1：查询词 = placeQuery 优先，否则从标题剥修饰词/取返程目的地
      const rawQuery = extractPlaceQuery(
        item.title,
        typeof item.payload?.placeQuery === 'string' ? item.payload.placeQuery : null,
      )
      if (!rawQuery || normalizePlaceQuery(rawQuery).length < 2) {
        skipped.push({ title: item.title, reason: '标题过于模糊，无法解析地点' })
        continue
      }
      if (!input.places) {
        skipped.push({ title: item.title, reason: '地点解析服务未配置' })
        continue
      }
      if (budgetExhausted()) {
        skipped.push({ title: item.title, reason: '本次保存的自动解析预算已用完' })
        continue
      }
      let place: ResolvedPlace | null = null
      try {
        // 传原始查询词（trim）：resolver 内部自己归一化做缓存键；归一化后的
        // 值只用于上面的长度/模糊词判断。预算由 resolveByText 的 onGoogleCall
        // 按真实外呼计量（N3：缓存/库命中不烧配额，失败与抛错同样已计数），
        // 不再用"成功后按 fromCache 计数"——错误路径漏计会超打 Google
        const result = await input.places.resolveByText(
          String(rawQuery).trim(),
          {
            ...(centroid ? { near: centroid, radiusM: NEAR_RADIUS_M } : {}),
            onGoogleCall: countGoogleCall,
          },
        )
        if (result.ok) {
          place = result.place
        } else {
          skipped.push({ title: item.title, reason: result.message })
        }
      } catch (err) {
        // 固定文案：内部异常细节不进 skipped（会被转述给模型）
        console.warn('[planAgent] place backfill resolve failed', err)
        skipped.push({ title: item.title, reason: '地点解析服务异常' })
      }
      if (!place) continue
      if (centroid && haversineKm(place, centroid) > MAX_DISTANCE_FROM_CENTROID_KM) {
        skipped.push({ title: item.title, reason: `解析结果距当天行程过远（${Math.round(haversineKm(place, centroid))} km）` })
        continue
      }
      if (!item.payload) item.payload = {}
      item.payload.place = place as unknown as Record<string, unknown>
      resolved += 1
    }
  }

  return { resolved, skipped }
}
