/**
 * P1+P2：模型价格解析与时段计价（docs/superpowers/plans/2026-09-10-dynamic-model-pricing.md §4/§5）。
 *
 * 价格解析优先级：
 * 1. 当前生效的 DB 接管供应商里该模型的价格字段（三字段齐全才算命中）
 * 2. MODEL_PRICES[model]
 * 3. MODEL_PRICES.default（兜底，调用方记入 priceFallbackModels 并告警）
 *
 * 时段口径：UTC 周一至周五的 01:00–04:00 与 06:00–10:00 为 peak（左闭右开），
 * 其余全部时间（含周末全天）为 offPeak；offPeak 价 = peak 减半（priceTable.halfPrice）。
 * 判定必须用 UTC 的星期与小时，不要用本地时区。
 */
import type { LlmModelConfig } from '@/lib/llm/types'
import type { LlmUsage } from '@/lib/llm/usage'
import { MODEL_PRICES, windowedPrice, type ModelPrice, type WindowedModelPrice } from './priceTable'

export type PricingWindow = 'peak' | 'offPeak'

/** DeepSeek 时段判定：UTC 周一至周五 01–4 时与 6–10 时为 peak，边界左闭右开（01:00:00 算 peak，04:00:00 算 offPeak）。 */
export function pricingWindowOf(at: Date): PricingWindow {
  const day = at.getUTCDay()
  if (day === 0 || day === 6) return 'offPeak' // 周日/周六全天
  const hour = at.getUTCHours()
  if ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)) return 'peak'
  return 'offPeak'
}

export type ModelPriceSource = 'provider' | 'table' | 'default'

export type ResolvedModelPrice = { price: WindowedModelPrice; source: ModelPriceSource }

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/**
 * P1：DB 供应商里该模型的价格（peak 牌价）。三个字段齐全且均为非负有限数才算
 * 配置；缺任一个（或值为 null/负数/NaN）视为未配置，回落价格表。
 */
function providerPriceOf(providerModels: readonly LlmModelConfig[], model: string): ModelPrice | null {
  const config = providerModels.find((m) => m.name === model)
  if (!config) return null
  const { inputMissPerM, inputCacheHitPerM, outputPerM } = config
  if (!isFiniteNonNegative(inputMissPerM) || !isFiniteNonNegative(inputCacheHitPerM) || !isFiniteNonNegative(outputPerM)) {
    return null
  }
  return { inputMissPerM, inputCacheHitPerM, outputPerM }
}

export function resolveModelPrice(model: string, providerModels?: readonly LlmModelConfig[] | null): ResolvedModelPrice {
  if (providerModels) {
    const fromProvider = providerPriceOf(providerModels, model)
    if (fromProvider) return { price: windowedPrice(fromProvider), source: 'provider' }
  }
  // F5：hasOwnProperty 判定，防 'constructor'/'toString' 等原型链键拿到函数当价格
  if (Object.prototype.hasOwnProperty.call(MODEL_PRICES, model)) {
    return { price: MODEL_PRICES[model], source: 'table' }
  }
  return { price: MODEL_PRICES.default, source: 'default' }
}

export function priceForWindow(price: WindowedModelPrice, window: PricingWindow): ModelPrice {
  return window === 'peak' ? price.peak : price.offPeak
}

/** 单次调用的成本：三个桶按各自每百万单价计价后合计取整（微美元）。reasoning 已含在 output 内不另计。 */
export function costOfUsageAtPrice(usage: LlmUsage, price: ModelPrice): number {
  return Math.round(
    (usage.inputMiss * price.inputMissPerM + usage.inputCacheHit * price.inputCacheHitPerM + usage.output * price.outputPerM) / 1_000_000,
  )
}

export type ModelCallPricing = { micros: number; window: PricingWindow; source: ModelPriceSource }

/** P2 计价点：按**调用时刻**的时段 × 解析出的价目给一次模型调用定价（跨时段边界的 run 靠逐次调用分段计价）。 */
export function priceModelCall(
  model: string,
  usage: LlmUsage,
  at: Date,
  providerModels?: readonly LlmModelConfig[] | null,
): ModelCallPricing {
  const resolved = resolveModelPrice(model, providerModels)
  const window = pricingWindowOf(at)
  return { micros: costOfUsageAtPrice(usage, priceForWindow(resolved.price, window)), window, source: resolved.source }
}
