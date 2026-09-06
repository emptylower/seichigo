import { describe, expect, it } from 'vitest'
import { costOfGoogleCalls, costOfModelUsage, EMPTY_GOOGLE_CALLS, summarizeRunCost } from '@/lib/billing/cost'
import { GOOGLE_PRICES_MICROS, MODEL_PRICES, PRICE_TABLE_VERSION, TITLE_OVERHEAD_MICROS } from '@/lib/billing/priceTable'

describe('costOfModelUsage', () => {
  it('prices each bucket per million tokens and rounds to integer micros', () => {
    const p = MODEL_PRICES['deepseek-v4-flash']
    const usage = { inputMiss: 1_000_000, inputCacheHit: 2_000_000, output: 500_000, reasoning: 100_000 }
    expect(costOfModelUsage('deepseek-v4-flash', usage)).toBe(
      p.inputMissPerM + 2 * p.inputCacheHitPerM + Math.round(p.outputPerM / 2),
    )
  })
  it('falls back to the default price for unknown models', () => {
    const usage = { inputMiss: 1_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }
    expect(costOfModelUsage('some-unknown-model', usage)).toBe(MODEL_PRICES.default.inputMissPerM)
  })
  it('F5：原型链上的模型名（constructor/toString）按 default 价格计价且不为 NaN', () => {
    const usage = { inputMiss: 1_000_000, inputCacheHit: 2_000_000, output: 500_000, reasoning: 0 }
    const d = MODEL_PRICES.default
    const expected = Math.round(
      (usage.inputMiss * d.inputMissPerM + usage.inputCacheHit * d.inputCacheHitPerM + usage.output * d.outputPerM) / 1_000_000,
    )
    expect(costOfModelUsage('constructor', usage)).toBe(expected)
    expect(costOfModelUsage('toString', usage)).toBe(expected)
    expect(costOfModelUsage('constructor', usage)).not.toBeNaN()
    expect(costOfModelUsage('toString', usage)).not.toBeNaN()
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
  it('builds the modelUsage json with totals, per-model usage and version', () => {
    const usageByModel = new Map([['deepseek-v4-flash', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }]])
    const summary = summarizeRunCost({
      usageByModel,
      calls: { placesTextSearch: 1, placesNearby: 0, placeDetails: 0, directions: 2 },
      modelCalls: 3,
      usageMissing: false,
      withTitle: true,
    })
    expect(summary.tokens).toEqual({ inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 })
    expect(summary.models).toEqual({ 'deepseek-v4-flash': { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 } })
    expect(summary.calls).toEqual({ placesTextSearch: 1, placesNearby: 0, placeDetails: 0, directions: 2 })
    expect(summary.costMicros.google).toBe(GOOGLE_PRICES_MICROS.placesTextSearch + 2 * GOOGLE_PRICES_MICROS.directions)
    expect(summary.costMicros.model).toBe(
      costOfModelUsage('deepseek-v4-flash', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }) + TITLE_OVERHEAD_MICROS,
    )
    expect(summary.costMicros.total).toBe(summary.costMicros.model + summary.costMicros.google)
    expect(summary.modelCalls).toBe(3)
    expect(summary.usageMissing).toBe(false)
    expect(summary.priceTableVersion).toBe(PRICE_TABLE_VERSION)
    expect(summary.priceFallbackModels).toEqual([])
  })

  it('F6：含未知模型时 priceFallbackModels 列出回退 default 计价的模型名', () => {
    const summary = summarizeRunCost({
      usageByModel: new Map([
        ['deepseek-v4-flash', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }],
        ['some-unknown-model', { inputMiss: 100, inputCacheHit: 0, output: 50, reasoning: 0 }],
      ]),
      calls: { ...EMPTY_GOOGLE_CALLS },
      modelCalls: 2,
      usageMissing: false,
      withTitle: false,
    })
    expect(summary.priceFallbackModels).toEqual(['some-unknown-model'])
  })
})
