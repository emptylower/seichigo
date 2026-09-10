import { describe, expect, it, vi } from 'vitest'
import type { PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { createRunCostTracker } from '@/lib/planAgent/runCost'
import { attachLlmUsage } from '@/lib/llm/usage'
import { createEnrichBudget, countGoogleCall } from '@/lib/planAgent/enrich/types'
import { PRICE_TABLE_VERSION, TITLE_OVERHEAD_MICROS } from '@/lib/billing/priceTable'
import { costOfGoogleCalls } from '@/lib/billing/cost'
import { __resetPriceFallbackReportingForTests } from '@/lib/billing/cost'
import type { LlmModelConfig } from '@/lib/llm/types'

/** 构造带 usage 与供应商信息的模型返回（provider 字段与 api.ts 同手法：不可枚举） */
function modelMessage(model: string, usage: { inputMiss: number; inputCacheHit: number; output: number; reasoning: number }): PlanAgentChatMessage {
  const message = attachLlmUsage({ role: 'assistant', content: '好', refusal: null } as PlanAgentChatMessage, usage)
  Object.defineProperty(message, 'provider', {
    value: { providerId: 'p', providerName: '测试供应商', model, protocol: 'openai' },
    enumerable: false,
    configurable: true,
  })
  return message
}

/** 固定时钟：2026-09-14（周一）12:00 UTC = offPeak；同日 02:00 UTC = peak */
const OFF_PEAK_MS = Date.parse('2026-09-14T12:00:00Z')
const PEAK_MS = Date.parse('2026-09-14T02:00:00Z')

describe('createRunCostTracker', () => {
  it('按模型累加多次调用的 usage 并计入 modelCalls（token 口径与时段无关）', () => {
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 12, withTitle: false, now: () => OFF_PEAK_MS })
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }))
    tracker.recordModelCall(modelMessage('deepseek-v4-pro', { inputMiss: 30, inputCacheHit: 0, output: 20, reasoning: 20 }))
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 1, inputCacheHit: 9, output: 5, reasoning: 0 }))
    expect(tracker.modelCalls).toBe(3)
    const summary = tracker.summary()
    expect(summary.tokens).toEqual({ inputMiss: 131, inputCacheHit: 909, output: 75, reasoning: 30 })
    expect(summary.models['deepseek-flash']).toEqual({ inputMiss: 101, inputCacheHit: 909, output: 55, reasoning: 10 })
    expect(summary.models['deepseek-v4-pro']).toEqual({ inputMiss: 30, inputCacheHit: 0, output: 20, reasoning: 20 })
    expect(summary.modelCalls).toBe(3)
    expect(summary.usageMissing).toBe(false)
    expect(summary.priceFallbackModels).toEqual([])
    expect(summary.priceTableVersion).toBe(PRICE_TABLE_VERSION)
  })

  it('F4：抛错的调用（response=null）计次并置 usageMissing；正常返回但缺 usage 同样标记（计次也进 pricingWindows）', () => {
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 12, withTitle: false, now: () => OFF_PEAK_MS })
    tracker.recordModelCall(null)
    expect(tracker.modelCalls).toBe(1)
    expect(tracker.summary().usageMissing).toBe(true)
    tracker.recordModelCall({ role: 'assistant', content: '好', refusal: null })
    expect(tracker.modelCalls).toBe(2)
    const summary = tracker.summary()
    expect(summary.usageMissing).toBe(true)
    expect(summary.tokens).toEqual({ inputMiss: 0, inputCacheHit: 0, output: 0, reasoning: 0 })
    expect(summary.costMicros.model).toBe(0)
    expect(summary.pricingWindows).toEqual({ peak: 0, offPeak: 2 })
  })

  it('P2 核心：同一个 run 跨过 04:00 UTC 边界，跨界前后的调用各按各时段计价', () => {
    let clockMs = Date.parse('2026-09-14T03:00:00Z') // 周一 03:00 peak
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 12, withTitle: false, now: () => clockMs })
    const perCall = { inputMiss: 1_000_000, inputCacheHit: 0, output: 1_000_000, reasoning: 0 }
    tracker.recordModelCall(modelMessage('deepseek-flash', perCall)) // peak：0.30 + 1.20 = 1_500_000 微美元
    clockMs = Date.parse('2026-09-14T05:00:00Z') // 越过 04:00 → offPeak
    tracker.recordModelCall(modelMessage('deepseek-flash', perCall)) // offPeak：0.15 + 0.60 = 750_000 微美元
    const summary = tracker.summary()
    expect(summary.costMicros.model).toBe(1_500_000 + 750_000)
    // 不能整段按同一个价算（旧口径的错法）
    expect(summary.costMicros.model).not.toBe(2 * 1_500_000)
    expect(summary.costMicros.model).not.toBe(2 * 750_000)
    expect(summary.pricingWindows).toEqual({ peak: 1, offPeak: 1 })
    // token 仍照常累加（run log 展示用）
    expect(summary.models['deepseek-flash']).toEqual({ inputMiss: 2_000_000, inputCacheHit: 0, output: 2_000_000, reasoning: 0 })
  })

  it('P2 边界精度：03:59:59.999 属 peak、04:00:00.000 属 offPeak（左闭右开，时钟可注入）', () => {
    let clockMs = Date.parse('2026-09-14T03:59:59.999Z')
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 12, withTitle: false, now: () => clockMs })
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 1_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }))
    clockMs = Date.parse('2026-09-14T04:00:00.000Z')
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 1_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }))
    // 300_000（peak）+ 150_000（offPeak）
    expect(tracker.summary().costMicros.model).toBe(450_000)
    expect(tracker.summary().pricingWindows).toEqual({ peak: 1, offPeak: 1 })
  })

  it('P2：周末全天 offPeak（周六落在 peak 窗口内的时刻也按半价）', () => {
    const tracker = createRunCostTracker({
      enrichBudget: createEnrichBudget(),
      maxIterations: 12,
      withTitle: false,
      now: () => Date.parse('2026-09-19T02:00:00Z'), // 周六 02:00（若按工作日会是 peak）
    })
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 1_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }))
    expect(tracker.summary().costMicros.model).toBe(150_000)
    expect(tracker.summary().pricingWindows).toEqual({ peak: 0, offPeak: 1 })
  })

  it('P1：接管供应商的价格字段覆盖表价（tracker 级生效）', () => {
    const providerModels: LlmModelConfig[] = [
      { name: 'deepseek-flash', contextLength: 128000, inputMissPerM: 100_000, inputCacheHitPerM: 0, outputPerM: 500_000 },
    ]
    const tracker = createRunCostTracker({
      enrichBudget: createEnrichBudget(),
      maxIterations: 12,
      withTitle: false,
      now: () => PEAK_MS,
      getProviderModels: () => providerModels,
    })
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 1_000_000, inputCacheHit: 0, output: 1_000_000, reasoning: 0 }))
    // provider peak：0.10 + 0.50 = 600_000（表价会是 1_500_000）
    const summary = tracker.summary()
    expect(summary.costMicros.model).toBe(600_000)
    expect(summary.priceFallbackModels).toEqual([])
  })

  it('P0：未知模型按 default（Flash peak）计价，进 priceFallbackModels 并触发告警', () => {
    __resetPriceFallbackReportingForTests()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 12, withTitle: false, now: () => PEAK_MS })
    tracker.recordModelCall(modelMessage('mystery-model', { inputMiss: 1_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }))
    const summary = tracker.summary()
    expect(summary.priceFallbackModels).toEqual(['mystery-model'])
    // default = Flash peak：inputMiss 300_000/M
    expect(summary.costMicros.model).toBe(300_000)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('mystery-model')
    warn.mockRestore()
    __resetPriceFallbackReportingForTests()
  })

  it('cap 只触发一次：压缩 Google 预算到 used、迭代上限收到 iteration+3，后续只读不重复注入', () => {
    const budget = createEnrichBudget()
    budget.places.used = 3
    budget.directions.used = 2
    const tracker = createRunCostTracker({ enrichBudget: budget, runCapMicros: 1_000_000, maxIterations: 12, withTitle: false, now: () => OFF_PEAK_MS })
    // 未达上限：不触发（offPeak 1M inputMiss = 150_000 微美元 < 1_000_000）
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 1_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }))
    const before = tracker.checkCap(1)
    expect(before).toEqual({ capReached: false, iterationLimit: 12 })
    expect(budget.places.max).toBe(40)
    // 巨额 usage 达到上限：触发（offPeak 50M inputMiss = 7_500_000）
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 50_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }))
    const hit = tracker.checkCap(2)
    expect(hit.capReached).toBe(true)
    expect(hit.systemNote).toContain('[系统状态]')
    expect(hit.iterationLimit).toBe(5)
    expect(tracker.iterationLimit).toBe(5)
    expect(budget.places.max).toBe(3)
    expect(budget.directions.max).toBe(2)
    // 再次检查：不再触发、不再压缩（used 归零后 max 不跟着变）、无 systemNote
    budget.places.used = 0
    budget.directions.used = 0
    const again = tracker.checkCap(9)
    expect(again.capReached).toBe(true)
    expect(again.systemNote).toBeUndefined()
    expect(again.iterationLimit).toBe(5)
    expect(budget.places.max).toBe(3)
    expect(budget.directions.max).toBe(2)
  })

  it('summary 口径：无调用的 run 标 usageMissing，withTitle 摊入标题开销，Google 调用取自 enrichBudget', () => {
    const empty = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 5, withTitle: false, now: () => OFF_PEAK_MS })
    const emptySummary = empty.summary()
    expect(emptySummary.usageMissing).toBe(true)
    expect(emptySummary.costMicros.total).toBe(0)
    expect(emptySummary.calls).toEqual({ placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 0 })

    const budget = createEnrichBudget()
    countGoogleCall(budget, 'directions')
    countGoogleCall(budget, 'placeDetails')
    const callUsage = { inputMiss: 1_000_000, inputCacheHit: 0, output: 100_000, reasoning: 0 }
    const withTitle = createRunCostTracker({ enrichBudget: budget, maxIterations: 5, withTitle: true, now: () => OFF_PEAK_MS })
    const withoutTitle = createRunCostTracker({ enrichBudget: budget, maxIterations: 5, withTitle: false, now: () => OFF_PEAK_MS })
    withTitle.recordModelCall(modelMessage('deepseek-flash', callUsage))
    withoutTitle.recordModelCall(modelMessage('deepseek-flash', callUsage))
    const a = withTitle.summary()
    const b = withoutTitle.summary()
    expect(a.calls).toEqual({ placesTextSearch: 0, placesNearby: 0, placeDetails: 1, directions: 1 })
    expect(b.costMicros.google).toBe(costOfGoogleCalls({ placesTextSearch: 0, placesNearby: 0, placeDetails: 1, directions: 1 }))
    // offPeak flash：inputMiss 150_000 + output 0.1M×600_000/M = 60_000 → 210_000
    expect(b.costMicros.model).toBe(210_000)
    expect(a.costMicros.model - b.costMicros.model).toBe(TITLE_OVERHEAD_MICROS)
    expect(a.costMicros.total - b.costMicros.total).toBe(TITLE_OVERHEAD_MICROS)
  })

  it('settle：回调一次 summary 与 hadModelOutput，回调抛错被吞掉', async () => {
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 5, withTitle: false, now: () => OFF_PEAK_MS })
    tracker.recordModelCall(modelMessage('deepseek-flash', { inputMiss: 100, inputCacheHit: 0, output: 10, reasoning: 0 }))
    const onRunCost = vi.fn(async (_summary: unknown, _hadModelOutput: boolean) => {})
    const summary = await tracker.settle(onRunCost)
    expect(onRunCost).toHaveBeenCalledTimes(1)
    expect(onRunCost.mock.calls[0][0]).toBe(summary)
    expect(onRunCost.mock.calls[0][1]).toBe(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const noThrow = await tracker.settle(async () => {
      throw new Error('boom')
    })
    expect(noThrow.modelCalls).toBe(1)
    const untouched = await tracker.settle(undefined)
    expect(untouched).toEqual(summary)
    warn.mockRestore()
  })
})
