import type { LlmUsage } from '@/lib/llm/usage'
import { addUsage, EMPTY_USAGE } from '@/lib/llm/usage'
import { GOOGLE_PRICES_MICROS, PRICE_TABLE_VERSION, TITLE_OVERHEAD_MICROS } from './priceTable'
import { costOfUsageAtPrice, priceForWindow, resolveModelPrice } from './priceResolver'

export type GoogleCallCounts = {
  placesTextSearch: number
  placesNearby: number
  placeDetails: number
  directions: number
}
export type GoogleCallCategory = keyof GoogleCallCounts

export const EMPTY_GOOGLE_CALLS: GoogleCallCounts = { placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 0 }

export function costOfGoogleCalls(calls: GoogleCallCounts): number {
  return (
    calls.placesTextSearch * GOOGLE_PRICES_MICROS.placesTextSearch +
    calls.placesNearby * GOOGLE_PRICES_MICROS.placesNearby +
    calls.placeDetails * GOOGLE_PRICES_MICROS.placeDetails +
    calls.directions * GOOGLE_PRICES_MICROS.directions
  )
}

/** P2：两个计价时段各自的模型调用次数（run log 事后对账用） */
export type PricingWindowCounts = { peak: number; offPeak: number }

/** TripPlanRunLog.modelUsage 里由 loop 写入的部分（供应商字段由 api.ts 合并） */
export type RunCostSummary = {
  tokens: LlmUsage
  models: Record<string, LlmUsage>
  calls: GoogleCallCounts
  costMicros: { model: number; google: number; total: number }
  modelCalls: number
  usageMissing: boolean
  /** F6：按 default 价格回退计价的模型名列表（空数组 = 全部命中供应商配置或价格表） */
  priceFallbackModels: string[]
  priceTableVersion: string
  /** P2：两个计价时段各自的模型调用次数（新增字段：历史日志没有它，读侧需容忍缺失） */
  pricingWindows: PricingWindowCounts
}

let reportedFallbackModels = new Set<string>()

/** 仅供测试：重置兜底计价告警的进程内去重状态 */
export function __resetPriceFallbackReportingForTests(): void {
  reportedFallbackModels = new Set()
}

/**
 * P0：兜底计价告警。priceFallbackModels 非空 = 有模型在按 default 价计费，属于
 * 配置错误，必须可见：console.warn + Sentry captureMessage。按模型名在进程内
 * 去重——checkCap 会在 run 中途反复构建 summary，不去重会刷屏。
 */
export function reportPriceFallbackModels(models: string[]): void {
  if (!models.length) return
  const fresh = models.filter((model) => !reportedFallbackModels.has(model))
  if (!fresh.length) return
  for (const model of fresh) reportedFallbackModels.add(model)
  console.warn(`[billing] 以下模型按兜底价计费（价格表与供应商配置都未覆盖，请尽快补齐）：${fresh.join('、')}`)
  void import('@sentry/nextjs')
    .then((Sentry) => Sentry.captureMessage(`billing price fallback: ${fresh.join(', ')}`, 'warning'))
    .catch(() => {
      // Sentry 不可用（未安装场景/本地测试环境）时保留 console.warn 即可
    })
}

export function summarizeRunCost(input: {
  usageByModel: Map<string, LlmUsage>
  calls: GoogleCallCounts
  modelCalls: number
  usageMissing: boolean
  /** 本 run 有新用户消息 → 标题侧信道跑过一次 */
  withTitle: boolean
  /**
   * P2：recordModelCall 按调用时刻逐次计价后的累计模型成本（微美元）。
   * 不传 = 旧口径（对累计 usage 按当前表价 peak 重算），仅供没有模型调用的
   * 日志路径（enrichContinuation）使用——那条路径 usageByModel 恒为空。
   */
  modelCostMicros?: number
  /** recordModelCall 逐次收集的兜底计价模型名；不传时按 usageByModel 是否命中价格表判定（F6 旧口径） */
  priceFallbackModels?: string[]
  /** 两个时段各自的模型调用次数；不传 = 0/0 */
  pricingWindows?: PricingWindowCounts
}): RunCostSummary {
  let tokens = EMPTY_USAGE
  let legacyCost = 0
  const legacyFallback: string[] = []
  for (const [name, usage] of input.usageByModel) {
    tokens = addUsage(tokens, usage)
    if (input.modelCostMicros === undefined) {
      const resolved = resolveModelPrice(name)
      legacyCost += costOfUsageAtPrice(usage, priceForWindow(resolved.price, 'peak'))
      if (resolved.source === 'default') legacyFallback.push(name)
    }
  }
  const fallback = input.priceFallbackModels ?? legacyFallback
  reportPriceFallbackModels(fallback)
  const model = (input.modelCostMicros ?? legacyCost) + (input.withTitle ? TITLE_OVERHEAD_MICROS : 0)
  const models: Record<string, LlmUsage> = {}
  for (const [name, usage] of input.usageByModel) models[name] = { ...usage }
  const google = costOfGoogleCalls(input.calls)
  return {
    tokens,
    models,
    calls: { ...input.calls },
    costMicros: { model, google, total: model + google },
    modelCalls: input.modelCalls,
    usageMissing: input.usageMissing,
    priceFallbackModels: fallback,
    priceTableVersion: PRICE_TABLE_VERSION,
    pricingWindows: input.pricingWindows ?? { peak: 0, offPeak: 0 },
  }
}
