/**
 * 价格表（设计 §7.3）。单位全部是微美元（1 美元 = 1,000,000）。
 *
 * 价格于 2026-09-10 核对自 DeepSeek 官方定价页。两档基准 peak 价（微美元/百万 token）：
 * - Flash：inputMiss 300_000 / cacheHit 6_000 / output 1_200_000
 * - Pro  ：inputMiss 1_320_000 / cacheHit 44_000 / output 3_960_000
 * off-peak 恒为 peak 一半（halfPrice()）。产品口径定为**按 peak 价计价**，
 * off-peak 的差价留作毛利缓冲。
 *
 * 未覆盖的模型（有意不填，不是遗漏）：生产库的 Gemini（gemini-3.8-flash /
 * gemini-3.8-flash-high）与 freecode（gpt-5.6-*）provider 均 takeoverAgent=false，
 * 不参与规划 agent 计费。改动任何数值都要同时更新 PRICE_TABLE_VERSION
 * （run log 用它标记口径）。
 */
import type { Tier } from './tiers'

export const PRICE_TABLE_VERSION = '2026-09-10'

/** 每百万 token 的价格（微美元）。$0.28/M = 280_000。 */
export type ModelPrice = { inputMissPerM: number; inputCacheHitPerM: number; outputPerM: number }

/**
 * P2 时段价目：peak 为牌价，offPeak 恒为 peak 减半（DeepSeek 谷时全线 5 折，
 * 见 docs/superpowers/plans/2026-09-10-dynamic-model-pricing.md §5.1）。
 * "半价"这个关系只存在于 halfPrice 一处，不许散落成魔数。
 */
export type WindowedModelPrice = { peak: ModelPrice; offPeak: ModelPrice }

/** 唯一的半价出处：所有 offPeak 价都必须由它从 peak 推导。 */
export function halfPrice(price: ModelPrice): ModelPrice {
  return {
    inputMissPerM: Math.round(price.inputMissPerM / 2),
    inputCacheHitPerM: Math.round(price.inputCacheHitPerM / 2),
    outputPerM: Math.round(price.outputPerM / 2),
  }
}

/** peak 牌价 → 时段价目（offPeak = 减半）。 */
export function windowedPrice(peak: ModelPrice): WindowedModelPrice {
  return { peak, offPeak: halfPrice(peak) }
}

/** DeepSeek Flash 档 peak 牌价（微美元/百万 token），2026-09-10 核对自官方定价页。 */
const DEEPSEEK_FLASH: ModelPrice = { inputMissPerM: 300_000, inputCacheHitPerM: 6_000, outputPerM: 1_200_000 }

/** DeepSeek Pro 档 peak 牌价（微美元/百万 token），2026-09-10 核对自官方定价页。 */
const DEEPSEEK_PRO: ModelPrice = { inputMissPerM: 1_320_000, inputCacheHitPerM: 44_000, outputPerM: 3_960_000 }

export const MODEL_PRICES: Record<string, WindowedModelPrice> & { default: WindowedModelPrice } = {
  // 当前正式名
  'deepseek-flash': windowedPrice(DEEPSEEK_FLASH),
  // 旧名已退役：请求由 V4.1-Flash 承接并**按 Flash 价计费**（官方说明）
  'deepseek-v4-flash': windowedPrice(DEEPSEEK_FLASH),
  // 同上：vision 实验版旧名，同样按 Flash 价计费
  'deepseek-v4-flash-vision-exp': windowedPrice(DEEPSEEK_FLASH),
  // 生产 agent 当前在用的模型（DB provider「DeepSeek（环境变量）」，takeoverAgent=true）
  'deepseek-v4.1-flash-expires-on-0910': windowedPrice(DEEPSEEK_FLASH),
  // ⚠️ 2026-09-14 12:00 北京时间（= 04:00 UTC）起，deepseek-v4-pro 的请求会被 DeepSeek
  // 路由到 V4.1 Flash 并按 Flash 价计费，直到 V4.1 Pro 发布。本表有意不做按日期自动
  // 切换（产品决定）：那天由维护者手动把此条目改成 Flash 价或删除；在那之前按 PRO 价。
  'deepseek-v4-pro': windowedPrice(DEEPSEEK_PRO),
  // 兜底 = Flash peak：当前所有在用的 DeepSeek 模型最终都按 Flash 价计费，
  // 用 Flash 兜底对绝大多数情况就是准确的，不再按最贵档多收。
  default: windowedPrice(DEEPSEEK_FLASH),
}

/** Google 每次调用价格（微美元）。$32/1000 次 = 32_000。 */
export const GOOGLE_PRICES_MICROS = {
  placesTextSearch: 32_000,
  placesNearby: 32_000,
  /** Place Details 含随后经镜像拉取的照片（Photos 按次价摊进这里，不单独计） */
  placeDetails: 24_000,
  directions: 5_000,
} as const

/**
 * 标题侧信道（每个带新用户消息的 run 一次，几百 token）按固定值摊入模型成本。
 * P2：这是固定摊销值，不走时段定价（500 微美元的量级在 peak/off-peak 差价下可忽略）。
 */
export const TITLE_OVERHEAD_MICROS = 500

/**
 * 套餐月价（美元）。标准档 $9.9/月由产品拍板（2026-09-06）；高级档首期
 * 不可购买，这里的数值只用于计算内测账号的预算。
 */
export const TIER_MONTHLY_PRICE_USD: Record<Tier, number> = { free: 0, standard: 9.9, pro: 29.9 }

/** 月度成本预算占月价的比例（设计 §3：45%，留 5 个点给手续费与摊销） */
export const COST_SHARE = 0.45

/** 免费档月预算（微美元）。示例值 = 免费路径 p75 单次成本 × 2.5，计量数据出来后校准 */
export const FREE_BUDGET_MICROS = 400_000

/** run 开始时的预扣额（微美元）：各档最近 30 天 p75 单次成本。示例值，计量数据出来后校准 */
export const RESERVE_MICROS: Record<Tier, number> = { free: 150_000, standard: 250_000, pro: 250_000 }

/** 单 run 成本上限占月预算的比例（设计 §6.2：付费 15%，免费 50%） */
export const RUN_CAP_SHARE: Record<Tier, number> = { free: 0.5, standard: 0.15, pro: 0.15 }
