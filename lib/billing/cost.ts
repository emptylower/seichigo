import type { LlmUsage } from '@/lib/llm/usage'
import { addUsage, EMPTY_USAGE } from '@/lib/llm/usage'
import { GOOGLE_PRICES_MICROS, MODEL_PRICES, PRICE_TABLE_VERSION, TITLE_OVERHEAD_MICROS } from './priceTable'

export type GoogleCallCounts = {
  placesTextSearch: number
  placesNearby: number
  placeDetails: number
  directions: number
}
export type GoogleCallCategory = keyof GoogleCallCounts

export const EMPTY_GOOGLE_CALLS: GoogleCallCounts = { placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 0 }

export function costOfModelUsage(model: string, usage: LlmUsage): number {
  // F5：hasOwnProperty 判定，防 'constructor'/'toString' 等原型链键拿到函数当价格
  const price = Object.prototype.hasOwnProperty.call(MODEL_PRICES, model) ? MODEL_PRICES[model] : MODEL_PRICES.default
  return Math.round(
    (usage.inputMiss * price.inputMissPerM + usage.inputCacheHit * price.inputCacheHitPerM + usage.output * price.outputPerM) /
      1_000_000,
  )
}

export function costOfGoogleCalls(calls: GoogleCallCounts): number {
  return (
    calls.placesTextSearch * GOOGLE_PRICES_MICROS.placesTextSearch +
    calls.placesNearby * GOOGLE_PRICES_MICROS.placesNearby +
    calls.placeDetails * GOOGLE_PRICES_MICROS.placeDetails +
    calls.directions * GOOGLE_PRICES_MICROS.directions
  )
}

/** TripPlanRunLog.modelUsage 里由 loop 写入的部分（供应商字段由 api.ts 合并） */
export type RunCostSummary = {
  tokens: LlmUsage
  models: Record<string, LlmUsage>
  calls: GoogleCallCounts
  costMicros: { model: number; google: number; total: number }
  modelCalls: number
  usageMissing: boolean
  /** F6：按 default 价格回退计价的模型名列表（空数组 = 全部命中价格表） */
  priceFallbackModels: string[]
  priceTableVersion: string
}

export function summarizeRunCost(input: {
  usageByModel: Map<string, LlmUsage>
  calls: GoogleCallCounts
  modelCalls: number
  usageMissing: boolean
  /** 本 run 有新用户消息 → 标题侧信道跑过一次 */
  withTitle: boolean
}): RunCostSummary {
  let tokens = EMPTY_USAGE
  let model = input.withTitle ? TITLE_OVERHEAD_MICROS : 0
  const models: Record<string, LlmUsage> = {}
  const priceFallbackModels: string[] = []
  for (const [name, usage] of input.usageByModel) {
    tokens = addUsage(tokens, usage)
    models[name] = { ...usage }
    if (!Object.prototype.hasOwnProperty.call(MODEL_PRICES, name)) priceFallbackModels.push(name)
    model += costOfModelUsage(name, usage)
  }
  const google = costOfGoogleCalls(input.calls)
  return {
    tokens,
    models,
    calls: { ...input.calls },
    costMicros: { model, google, total: model + google },
    modelCalls: input.modelCalls,
    usageMissing: input.usageMissing,
    priceFallbackModels,
    priceTableVersion: PRICE_TABLE_VERSION,
  }
}
