import { validateExternalPlacePayload } from '@/lib/googlePlaces/places'
import type { NearbySearchResult } from '@/lib/googlePlaces/nearby'
import { meterGoogleCall, type EnrichContext, type EnrichDay, type EnrichReport } from './types'

/**
 * restaurant enricher（A6 餐厅必达；R3 并发化；S4/S6 第五轮审查修订）：
 * 午餐/晚餐 meal 条目仍无合法 payload.place 时，调 find_restaurants 取餐厅
 * 写入 payload.place（完整 ResolvedPlace，含 photo/photos），note 追加备选名单。
 * - 只处理 mealSlot === 'lunch' | 'dinner'（早餐不强制推荐、静默跳过）；
 * - R3：先收集待搜条目，再按唯一搜索中心（lat,lng 四位小数）以并发 4 执行
 *   findRestaurants，按原顺序写回；同一中心的多次用餐复用第一次结果；
 * - S4：同一天按已分配 placeId 去重——每个 meal 从其搜索组结果里取第一个
 *   当天没用过的餐厅，全用过才允许重复（跨中心的命中同样不重复推荐）；
 * - 预算：mealEnricher 为本 enricher 预留 places 点数（places.reserved），
 *   收集阶段逐条释放（不论后续是否派发——无中心/未配置/预算耗尽都不再
 *   占用预留）；places 预算在发起前预扣（used += 1）防并发超发，
 *   onGoogleCall 只做校准——实际没有外呼（限流/配置错误/坐标非法等）则
 *   回退 1；
 * - 失败（无结果/预算/异常）写 payload.restaurantPending = true，下一轮
 *   保存或补齐续跑（R4）会再试。
 * 搜索中心依次取：同一天该条目之前最近一个有坐标条目 → 同一天之后第一个有
 * 坐标条目（早餐在当天首位的情形）→ 前一天最后一个有坐标条目；都没有记
 * skipped。
 */

/** 同一时刻最多 4 个餐厅搜索在飞（R3） */
const RESTAURANT_SEARCH_CONCURRENCY = 4

function coordsOfItem(item: EnrichDay['items'][number], ctx: EnrichContext): { lat: number; lng: number } | null {
  if (item.pointId) {
    const hit = ctx.coordsByPointId.get(item.pointId)
    if (hit) return { lat: hit.lat, lng: hit.lng }
  }
  const place = item.payload?.place
  if (place && typeof place === 'object' && !Array.isArray(place)) {
    const lat = Number((place as Record<string, unknown>).lat)
    const lng = Number((place as Record<string, unknown>).lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  }
  return null
}

function visitCoordsOf(item: EnrichDay['items'][number], ctx: EnrichContext): { lat: number; lng: number } | null {
  if (item.type === 'transit') return null
  return coordsOfItem(item, ctx)
}

/** 搜索中心：当天前置最近 → 当天后续第一个 → 前一天最后一个；都没有返回 null */
function resolveSearchCenter(
  days: EnrichDay[],
  day: EnrichDay,
  item: EnrichDay['items'][number],
  ctx: EnrichContext,
): { lat: number; lng: number } | null {
  let nearest: { lat: number; lng: number } | null = null
  for (const other of day.items) {
    if (other === item) break
    nearest = visitCoordsOf(other, ctx) ?? nearest
  }
  if (nearest) return nearest
  let seenCurrent = false
  for (const other of day.items) {
    if (other === item) {
      seenCurrent = true
      continue
    }
    if (!seenCurrent) continue
    const following = visitCoordsOf(other, ctx)
    if (following) return following
  }
  const dayPosition = days.indexOf(day)
  if (dayPosition > 0) {
    const previous = days[dayPosition - 1]
    for (let i = previous.items.length - 1; i >= 0; i--) {
      const coords = visitCoordsOf(previous.items[i], ctx)
      if (coords) return coords
    }
  }
  return null
}

/** Nearby 结果剥离附带的评分/出处兄弟字段，只留 ResolvedPlace 基座 */
function toBasePlace(restaurant: Record<string, unknown>): Record<string, unknown> {
  const { rating: _r, userRatingsTotal: _u, priceLevel: _p, optionProvenance: _o, ...place } = restaurant
  return place
}

type PendingMeal = { day: EnrichDay; item: EnrichDay['items'][number]; group: SearchGroup }

type SearchGroup = {
  center: { lat: number; lng: number }
  meals: PendingMeal[]
  /** budget：发起前预算已耗尽（整组跳过）；done：搜索已执行 */
  status: 'pending' | 'budget' | 'done'
  /** onGoogleCall 计数：0 表示实际没有外呼（预扣回退） */
  actualCalls: number
  result: NearbySearchResult | null
}

/** 定长并发执行（R3）：worker 池逐个领取任务，任意顺序完成 */
async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (index < tasks.length) {
      const current = index
      index += 1
      await tasks[current]()
    }
  })
  await Promise.all(workers)
}

export async function runRestaurantEnricher(days: EnrichDay[], ctx: EnrichContext, report: EnrichReport): Promise<void> {
  if (ctx.entitlements && !ctx.entitlements.restaurants) {
    for (const day of days) {
      for (const item of day.items) {
        if (item.type === 'meal') report.skipped.push({ enricher: 'restaurant', itemTitle: item.title, reason: '当前档位不含餐厅推荐' })
      }
    }
    return
  }
  const findRestaurants = ctx.deps.findRestaurants
  const allMeals: PendingMeal[] = []
  const groups = new Map<string, SearchGroup>()

  // 阶段 1：收集待搜条目（含各自 center）；同中心（四位小数）聚合为一组。
  // S6：每个收集到的 meal 在此逐条释放 mealEnricher 的预留——不论后续是否
  // 派发（未配置/无中心/预算耗尽都不再占用预留），保证"逐条释放"契约
  for (const day of days) {
    for (const item of day.items) {
      if (item.type !== 'meal') continue
      const slot = item.payload?.mealSlot
      if (slot !== 'lunch' && slot !== 'dinner') continue // 早餐不强制推荐：静默跳过
      if (validateExternalPlacePayload(item.payload?.place) === null) continue // 已有合法 place
      if (ctx.budget) {
        ctx.budget.places.reserved = Math.max(0, (ctx.budget.places.reserved ?? 0) - 1)
      }
      if (!findRestaurants) {
        report.skipped.push({ enricher: 'restaurant', itemTitle: item.title, reason: '餐厅搜索服务未配置' })
        continue
      }
      const center = resolveSearchCenter(days, day, item, ctx)
      if (!center) {
        report.skipped.push({ enricher: 'restaurant', itemTitle: item.title, reason: '当天与前一天都没有可用的坐标作为搜索中心' })
        if (!item.payload) item.payload = {}
        item.payload.restaurantPending = true
        continue
      }
      const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`
      let group = groups.get(key)
      if (!group) {
        group = { center, meals: [], status: 'pending', actualCalls: 0, result: null }
        groups.set(key, group)
      }
      const meal: PendingMeal = { day, item, group }
      group.meals.push(meal)
      allMeals.push(meal)
    }
  }
  if (!findRestaurants || !allMeals.length) return

  // 阶段 2：发起前判定与预扣（防并发超发；预留已在收集阶段逐条释放）
  const dispatchQueue: SearchGroup[] = []
  for (const group of groups.values()) {
    if (ctx.budget && ctx.budget.places.used >= ctx.budget.places.max) {
      group.status = 'budget'
      continue
    }
    if (ctx.budget) ctx.budget.places.used += 1
    dispatchQueue.push(group)
  }

  // 阶段 3：并发 4 执行搜索；onGoogleCall 只计数，结束后校准预算
  await runWithConcurrency(
    dispatchQueue.map((group) => async () => {
      try {
        group.result = await findRestaurants({
          lat: group.center.lat,
          lng: group.center.lng,
          onGoogleCall: () => {
            group.actualCalls += 1
            if (ctx.budget) meterGoogleCall(ctx.budget, 'placesNearby')
          },
        })
      } catch {
        group.result = { ok: false, code: 'provider_error', message: '餐厅搜索服务异常' }
      }
      group.status = 'done'
      // 校准：预扣了 1 但实际没有外呼（限流/配置错误/坐标非法等）→ 回退 1
      if (ctx.budget && group.actualCalls === 0) {
        ctx.budget.places.used = Math.max(0, ctx.budget.places.used - 1)
      }
    }),
    RESTAURANT_SEARCH_CONCURRENCY,
  )

  // 阶段 4：按原顺序写回；S4 同一天按已分配 placeId 去重——每个 meal 取其
  // 搜索组结果里第一个当天没用过的餐厅，全用过才允许重复
  const usedPlaceIdsByDay = new Map<EnrichDay, Set<string>>()
  for (const { day, item, group } of allMeals) {
    const markPending = () => {
      if (!item.payload) item.payload = {}
      item.payload.restaurantPending = true
    }
    if (group.status === 'budget') {
      report.skipped.push({ enricher: 'restaurant', itemTitle: item.title, reason: '本次保存的 Google 调用预算已用完' })
      markPending()
      continue
    }
    const result = group.result
    if (!result) {
      report.skipped.push({ enricher: 'restaurant', itemTitle: item.title, reason: '餐厅搜索服务异常' })
      markPending()
      continue
    }
    if (!result.ok || !result.restaurants.length) {
      report.skipped.push({
        enricher: 'restaurant',
        itemTitle: item.title,
        reason: result.ok ? '附近没有找到符合条件的餐厅' : result.message,
      })
      markPending()
      continue
    }
    let used = usedPlaceIdsByDay.get(day)
    if (!used) {
      used = new Set<string>()
      usedPlaceIdsByDay.set(day, used)
    }
    const best = result.restaurants.find((r) => !used.has(r.placeId)) ?? result.restaurants[0]
    if (!best) {
      // 防御分支：候选非空时上方兜底必然命中，这里只兜类型收窄
      report.skipped.push({ enricher: 'restaurant', itemTitle: item.title, reason: '附近没有找到符合条件的餐厅' })
      markPending()
      continue
    }
    used.add(best.placeId)
    if (!item.payload) item.payload = {}
    item.payload.place = toBasePlace(best as unknown as Record<string, unknown>)
    delete item.payload.restaurantPending
    const alternatives = result.restaurants
      .filter((r) => r.placeId !== best.placeId)
      .slice(0, 2)
      .map((r) => `${r.name}（${r.rating}）`)
      .join('、')
    // 备选为空时不追加任何后缀，避免留下尾部「；」
    if (alternatives) {
      const suffix = `备选：${alternatives}`
      item.note = item.note ? `${item.note}；${suffix}` : suffix
    }
    report.applied.restaurant += 1
  }
}
