import { describe, expect, it, vi } from 'vitest'
import {
  __resetPriceFallbackReportingForTests,
  costOfGoogleCalls,
  EMPTY_GOOGLE_CALLS,
  reportPriceFallbackModels,
  summarizeRunCost,
} from '@/lib/billing/cost'
import { GOOGLE_PRICES_MICROS, halfPrice, MODEL_PRICES, PRICE_TABLE_VERSION, TITLE_OVERHEAD_MICROS } from '@/lib/billing/priceTable'

describe('MODEL_PRICES（P0 止血：2026-09-10 口径）', () => {
  it('deepseek-flash / deepseek-v4-pro 按真实 peak 牌价；旧的不存在条目已删除', () => {
    expect(PRICE_TABLE_VERSION).toBe('2026-09-10')
    expect(MODEL_PRICES['deepseek-flash'].peak).toEqual({
      inputMissPerM: 300_000,
      inputCacheHitPerM: 6_000,
      outputPerM: 1_200_000,
    })
    expect(MODEL_PRICES['deepseek-v4-pro'].peak).toEqual({
      inputMissPerM: 1_320_000,
      inputCacheHitPerM: 44_000,
      outputPerM: 3_960_000,
    })
    // deepseek-v4-flash 系旧名已按官方说明回到表内（请求由 V4.1-Flash 承接并按 Flash 价计费）
    for (const stale of ['deepseek-chat', 'deepseek-reasoner']) {
      expect(Object.prototype.hasOwnProperty.call(MODEL_PRICES, stale)).toBe(false)
    }
  })

  it('default 兜底 = Flash peak（2026-09-10 口径：在用 DeepSeek 模型最终都按 Flash 价计费，不再按最贵档多收）', () => {
    expect(MODEL_PRICES.default.peak).toEqual(MODEL_PRICES['deepseek-flash'].peak)
  })

  it('P2：所有条目的 offPeak 恒为 peak 减半（半价关系显式成立）', () => {
    for (const key of Object.keys(MODEL_PRICES)) {
      expect(MODEL_PRICES[key].offPeak).toEqual(halfPrice(MODEL_PRICES[key].peak))
    }
    expect(MODEL_PRICES['deepseek-flash'].offPeak).toEqual({
      inputMissPerM: 150_000,
      inputCacheHitPerM: 3_000,
      outputPerM: 600_000,
    })
  })
})

describe('costOfGoogleCalls', () => {
  it('multiplies each category by its unit price', () => {
    expect(costOfGoogleCalls({ placesTextSearch: 2, placesNearby: 1, placeDetails: 3, directions: 4 })).toBe(
      2 * GOOGLE_PRICES_MICROS.placesTextSearch +
        GOOGLE_PRICES_MICROS.placesNearby +
        3 * GOOGLE_PRICES_MICROS.placeDetails +
        4 * GOOGLE_PRICES_MICROS.directions,
    )
    expect(costOfGoogleCalls(EMPTY_GOOGLE_CALLS)).toBe(0)
  })
})

describe('summarizeRunCost', () => {
  it('P2 口径：costMicros.model = 逐次计价累计之和 + 标题摊销，pricingWindows 原样落进 run log', () => {
    const summary = summarizeRunCost({
      usageByModel: new Map([['deepseek-flash', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }]]),
      calls: { placesTextSearch: 1, placesNearby: 0, placeDetails: 0, directions: 2 },
      modelCalls: 3,
      usageMissing: false,
      withTitle: true,
      modelCostMicros: 12_345,
      pricingWindows: { peak: 2, offPeak: 1 },
      priceFallbackModels: [],
    })
    expect(summary.tokens).toEqual({ inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 })
    expect(summary.models).toEqual({ 'deepseek-flash': { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 } })
    expect(summary.calls).toEqual({ placesTextSearch: 1, placesNearby: 0, placeDetails: 0, directions: 2 })
    expect(summary.costMicros.google).toBe(GOOGLE_PRICES_MICROS.placesTextSearch + 2 * GOOGLE_PRICES_MICROS.directions)
    expect(summary.costMicros.model).toBe(12_345 + TITLE_OVERHEAD_MICROS)
    expect(summary.costMicros.total).toBe(summary.costMicros.model + summary.costMicros.google)
    expect(summary.modelCalls).toBe(3)
    expect(summary.usageMissing).toBe(false)
    expect(summary.priceFallbackModels).toEqual([])
    expect(summary.priceTableVersion).toBe(PRICE_TABLE_VERSION)
    expect(summary.pricingWindows).toEqual({ peak: 2, offPeak: 1 })
  })

  it('legacy 口径（modelCostMicros 缺省，enrichContinuation 路径）：usage 为空时模型成本为 0、pricingWindows 为 0/0', () => {
    const summary = summarizeRunCost({
      usageByModel: new Map(),
      calls: { ...EMPTY_GOOGLE_CALLS },
      modelCalls: 0,
      usageMissing: false,
      withTitle: false,
    })
    expect(summary.costMicros.model).toBe(0)
    expect(summary.costMicros.total).toBe(0)
    expect(summary.priceFallbackModels).toEqual([])
    expect(summary.pricingWindows).toEqual({ peak: 0, offPeak: 0 })
  })

  it('F6/P0：含未知模型时 priceFallbackModels 列出模型名并触发告警；进程内按模型去重', () => {
    __resetPriceFallbackReportingForTests()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const input = {
      usageByModel: new Map([
        ['deepseek-flash', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }],
        ['some-unknown-model', { inputMiss: 100, inputCacheHit: 0, output: 50, reasoning: 0 }],
      ]),
      calls: { ...EMPTY_GOOGLE_CALLS },
      modelCalls: 2,
      usageMissing: false,
      withTitle: false,
    }
    const summary = summarizeRunCost(input)
    expect(summary.priceFallbackModels).toEqual(['some-unknown-model'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('some-unknown-model')
    // 第二次汇总（如 checkCap 中途构建）：去重不再重复告警
    summarizeRunCost(input)
    expect(warn).toHaveBeenCalledTimes(1)
    // 另一个新未知模型：仍会告警一次
    summarizeRunCost({
      ...input,
      usageByModel: new Map([['another-unknown', { inputMiss: 1, inputCacheHit: 0, output: 0, reasoning: 0 }]]),
    })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[1][0])).toContain('another-unknown')
    // 空列表是 no-op
    reportPriceFallbackModels([])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
    __resetPriceFallbackReportingForTests()
  })
})
