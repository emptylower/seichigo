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
