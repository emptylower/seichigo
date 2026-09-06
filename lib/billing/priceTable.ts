/**
 * 价格表（设计 §7.3）。单位全部是微美元（1 美元 = 1,000,000）。
 *
 * 抄录日期：2026-09-06。下面的数值是按供应商公开牌价填的**初始值**，
 * 上线扣费前必须对照 DeepSeek 与 Google Maps Platform 当前价格页逐项核对，
 * 改动任何数值都要同时更新 PRICE_TABLE_VERSION（run log 用它标记口径）。
 */
export const PRICE_TABLE_VERSION = '2026-09-06'

/** 每百万 token 的价格（微美元）。$0.28/M = 280_000。 */
export type ModelPrice = { inputMissPerM: number; inputCacheHitPerM: number; outputPerM: number }

export const MODEL_PRICES: Record<string, ModelPrice> & { default: ModelPrice } = {
  default: { inputMissPerM: 280_000, inputCacheHitPerM: 28_000, outputPerM: 420_000 },
  'deepseek-v4-flash': { inputMissPerM: 280_000, inputCacheHitPerM: 28_000, outputPerM: 420_000 },
  'deepseek-chat': { inputMissPerM: 280_000, inputCacheHitPerM: 28_000, outputPerM: 420_000 },
  'deepseek-reasoner': { inputMissPerM: 280_000, inputCacheHitPerM: 28_000, outputPerM: 420_000 },
}

/** Google 每次调用价格（微美元）。$32/1000 次 = 32_000。 */
export const GOOGLE_PRICES_MICROS = {
  placesTextSearch: 32_000,
  placesNearby: 32_000,
  /** Place Details 含随后经镜像拉取的照片（Photos 按次价摊进这里，不单独计） */
  placeDetails: 24_000,
  directions: 5_000,
} as const

/** 标题侧信道（每个带新用户消息的 run 一次，几百 token）按固定值摊入模型成本 */
export const TITLE_OVERHEAD_MICROS = 500
import type { Tier } from './tiers'

/** 人民币标价 → 美元成本口径的换算（调价时人工更新） */
export const CNY_PER_USD = 7.2

/**
 * 套餐月价（人民币）。**示例值**：标准档月价在计量层跑满两周、拿到 p75
 * 单次成本后按设计 §10 校准；高级档首期不可购买，这里的数值只用于计算
 * 内测账号的预算。
 */
export const TIER_MONTHLY_PRICE_CNY: Record<Tier, number> = { free: 0, standard: 29.9, pro: 99 }

/** 月度成本预算占月价的比例（设计 §3：45%，留 5 个点给手续费与摊销） */
export const COST_SHARE = 0.45

/** 免费档月预算（微美元）。示例值 = 免费路径 p75 单次成本 × 2.5，计量数据出来后校准 */
export const FREE_BUDGET_MICROS = 400_000

/** run 开始时的预扣额（微美元）：各档最近 30 天 p75 单次成本。示例值，计量数据出来后校准 */
export const RESERVE_MICROS: Record<Tier, number> = { free: 150_000, standard: 400_000, pro: 400_000 }

/** 单 run 成本上限占月预算的比例（设计 §6.2：付费 15%，免费 50%） */
export const RUN_CAP_SHARE: Record<Tier, number> = { free: 0.5, standard: 0.15, pro: 0.15 }
