import type { ScheduleItemInput } from '../schedule'
import type { PlacePhotoRef, PlaceResolver } from '@/lib/googlePlaces/places'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'
import type { NearbySearchResult } from '@/lib/googlePlaces/nearby'
import type { TravelQueryFn } from '../travelQuery'
import { EMPTY_GOOGLE_CALLS, type GoogleCallCategory, type GoogleCallCounts } from '@/lib/billing/cost'
import type { Entitlements } from '@/lib/billing/tiers'
import type { SupportedLocale } from '@/lib/i18n/types'

/**
 * M4 补齐层（设计 §4）：save_plan_days 落库前按固定顺序执行的服务端脚本。
 * 全部幂等、失败静默记 skipped；Google 调用按 provider 分桶限量（R3 上调后
 * directions/places 各 40 次/窗口，均低于 googleClient 60/分钟与 places.ts
 * 60/分钟的窗口；同一份预算同时覆盖 enricher 与模型自己发起的工具调用，
 * 见 N4），超出部分留给下一回合或补齐续跑（R4）继续补。
 */

export type EnricherName = 'meal' | 'place' | 'restaurant' | 'transport' | 'schedule' | 'media' | 'dedupe' | 'neighbor'

/**
 * 共享 Google 调用预算：directions（Directions API，交通）与 places
 * （Places API，地点/餐厅）分开计量——两者的服务端限速窗口独立，
 * 混在一个计数里会互相挤占。引用传递，原地累加。同一 run 内模型工具调用
 * （estimate_travel/resolve_place/find_restaurants）与 enricher 共用同一份。
 *
 * 回归第三轮 A5：
 * - 预留：模型工具调用最多用到 directions.max-10 / places.max-10（见
 *   modelDirectionsCap / modelPlacesCap），超出返回 budget_exhausted——
 *   补齐脚本（save_plan_days 的 enricher）可用完整预算；
 * - 时间窗滚动：windowStartedAt 距今 ≥ 60s 的下一次检查把 used 归零并重开
 *   窗口（rollEnrichBudgetWindow），与 Google 侧的分钟级限速窗口对齐，
 *   长会话不会一轮就把整个 run 的配额永久锁死。
 *
 * 回归第四轮 A6：places.reserved——mealEnricher 为午餐/晚餐餐厅补齐预留的
 * 次数。place 兜底解析（placeBackstop）按 placesRemaining 判定预算耗尽，
 * 保证餐厅补齐在地点解析之后仍有点数；restaurant enricher 处理时逐条释放。
 */
export type EnrichBudget = {
  directions: { used: number; max: number }
  places: { used: number; max: number; /** 餐厅补齐预留（缺省视为 0） */ reserved?: number }
  /** 当前预算窗口开始时间（epoch ms） */
  windowStartedAt: number
  /** 本 run 累计真实外呼次数（不随时间窗归零；设计 §7.2 计量层） */
  calls?: GoogleCallCounts
  /** 可注入时钟（测试）；缺省 Date.now */
  now?: () => number
}

export const ENRICH_DIRECTIONS_MAX_DEFAULT = 40
export const ENRICH_PLACES_MAX_DEFAULT = 40
export const ENRICH_BUDGET_WINDOW_MS = 60_000

/** 模型工具调用的预留量：补齐脚本专用，模型用超即 budget_exhausted */
export const MODEL_DIRECTIONS_BUDGET_RESERVE = 10
export const MODEL_PLACES_BUDGET_RESERVE = 10

export function createEnrichBudget(options?: { now?: () => number }): EnrichBudget {
  const now = options?.now ?? (() => Date.now())
  return {
    directions: { used: 0, max: ENRICH_DIRECTIONS_MAX_DEFAULT },
    places: { used: 0, max: ENRICH_PLACES_MAX_DEFAULT, reserved: 0 },
    calls: { ...EMPTY_GOOGLE_CALLS },
    windowStartedAt: now(),
    now,
  }
}

/** 检查时滚动：距窗口开始 ≥ 60s → used 归零并重开窗口（reserved 不动） */
export function rollEnrichBudgetWindow(budget: EnrichBudget): void {
  const clock = budget.now ?? (() => Date.now())
  if (clock() - budget.windowStartedAt >= ENRICH_BUDGET_WINDOW_MS) {
    budget.directions.used = 0
    budget.places.used = 0
    budget.windowStartedAt = clock()
  }
}

/** 除去预留后 places 还可用的次数（预留给餐厅补齐） */
export function placesRemaining(budget: EnrichBudget): number {
  return Math.max(0, budget.places.max - budget.places.used - (budget.places.reserved ?? 0))
}

/** 模型可用的 directions 上限（max - 预留 10；不低于 0） */
export function modelDirectionsCap(budget: EnrichBudget): number {
  return Math.max(0, budget.directions.max - MODEL_DIRECTIONS_BUDGET_RESERVE)
}

/** 模型可用的 places 上限（max - 预留 10；不低于 0） */
export function modelPlacesCap(budget: EnrichBudget): number {
  return Math.max(0, budget.places.max - MODEL_PLACES_BUDGET_RESERVE)
}

/** plan.preferences.travelMode → enrich 层的出行偏好（非法值视为缺省 mixed） */
export function readTravelMode(preferences: unknown): EnrichTravelMode | undefined {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return undefined
  const raw = (preferences as Record<string, unknown>).travelMode
  if (raw === 'walk' || raw === 'transit' || raw === 'driving' || raw === 'mixed') return raw
  return undefined
}

export type EnrichSkip = { enricher: EnricherName; itemTitle: string; reason: string }

export type EnrichReport = {
  applied: Record<EnricherName, number>
  skipped: EnrichSkip[]
  googleCallsUsed: { directions: number; places: number }
}

export type EnrichItem = ScheduleItemInput

export type EnrichDay = {
  dayIndex: number
  /** S5：巡礼日期原样透传（save 路径没有 date，续跑路径从落库天带回） */
  date?: Date | null
  citySlug: string | null
  summary: string | null
  items: EnrichItem[]
}

export type EnrichTravelMode = 'walk' | 'transit' | 'driving' | 'mixed'

export type EnrichContext = {
  deps: {
    places?: PlaceResolver
    /** 地点库（A2：按 placeId 回查被模型裁剪掉的 place.photo） */
    externalPlaces?: ExternalPlaceStore
    /** Place Details 整组照片补拉（A4 图片去重用；serverDeps 有 apiKey 时装配） */
    fetchPlacePhotos?: (input: {
      placeId: string
      onGoogleCall?: () => void
    }) => Promise<PlacePhotoRef[] | null>
    findRestaurants?: (input: {
      lat: number
      lng: number
      radiusM?: number
      keyword?: string
      onGoogleCall?: () => void
    }) => Promise<NearbySearchResult>
    travel?: TravelQueryFn
  }
  /** 站内点位坐标表（getPointsByIds 构建，含 image） */
  coordsByPointId: Map<string, { lat: number; lng: number; image?: string | null }>
  /** 当天已知坐标（质心偏置用，place enricher） */
  dayCoordinates?: (dayIndex: number) => Array<{ lat: number; lng: number }>
  travelMode?: EnrichTravelMode
  budget?: EnrichBudget
  /** §0.6 站点语言：补齐层写入用户可见文案（餐食标签等）时使用；缺省 zh */
  locale?: SupportedLocale
  /** 档位能力表（设计 §5 卡点 2）；缺省视为全开 */
  entitlements?: Entitlements
}

export function emptyEnrichReport(): EnrichReport {
  return {
    applied: { meal: 0, place: 0, restaurant: 0, transport: 0, schedule: 0, media: 0, dedupe: 0, neighbor: 0 },
    skipped: [],
    googleCallsUsed: { directions: 0, places: 0 },
  }
}

/** 只累加本 run 计量（预算桶已由调用方预扣时用） */
export function meterGoogleCall(budget: EnrichBudget, category: GoogleCallCategory): void {
  if (!budget.calls) budget.calls = { ...EMPTY_GOOGLE_CALLS }
  budget.calls[category] += 1
}

/** 真实外呼一次：预算桶 used+1（places 三类共用 places 桶）并累加本 run 计量 */
export function countGoogleCall(budget: EnrichBudget, category: GoogleCallCategory): void {
  if (category === 'directions') budget.directions.used += 1
  else budget.places.used += 1
  meterGoogleCall(budget, category)
}
