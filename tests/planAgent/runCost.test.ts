import { describe, expect, it, vi } from 'vitest'
import type { PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { createRunCostTracker } from '@/lib/planAgent/runCost'
import { attachLlmUsage } from '@/lib/llm/usage'
import { createEnrichBudget, countGoogleCall } from '@/lib/planAgent/enrich/types'
import { PRICE_TABLE_VERSION, TITLE_OVERHEAD_MICROS } from '@/lib/billing/priceTable'
import { costOfGoogleCalls, costOfModelUsage } from '@/lib/billing/cost'

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

describe('createRunCostTracker', () => {
  it('按模型累加多次调用的 usage 并计入 modelCalls', () => {
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 12, withTitle: false })
    tracker.recordModelCall(modelMessage('deepseek-chat', { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 }))
    tracker.recordModelCall(modelMessage('deepseek-reasoner', { inputMiss: 30, inputCacheHit: 0, output: 20, reasoning: 20 }))
    tracker.recordModelCall(modelMessage('deepseek-chat', { inputMiss: 1, inputCacheHit: 9, output: 5, reasoning: 0 }))
    expect(tracker.modelCalls).toBe(3)
    const summary = tracker.summary()
    expect(summary.tokens).toEqual({ inputMiss: 131, inputCacheHit: 909, output: 75, reasoning: 30 })
    expect(summary.models['deepseek-chat']).toEqual({ inputMiss: 101, inputCacheHit: 909, output: 55, reasoning: 10 })
    expect(summary.models['deepseek-reasoner']).toEqual({ inputMiss: 30, inputCacheHit: 0, output: 20, reasoning: 20 })
    expect(summary.modelCalls).toBe(3)
    expect(summary.usageMissing).toBe(false)
    expect(summary.priceFallbackModels).toEqual([])
    expect(summary.priceTableVersion).toBe(PRICE_TABLE_VERSION)
  })

  it('F4：抛错的调用（response=null）计次并置 usageMissing；正常返回但缺 usage 同样标记', () => {
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 12, withTitle: false })
    tracker.recordModelCall(null)
    expect(tracker.modelCalls).toBe(1)
    expect(tracker.summary().usageMissing).toBe(true)
    tracker.recordModelCall({ role: 'assistant', content: '好', refusal: null })
    expect(tracker.modelCalls).toBe(2)
    const summary = tracker.summary()
    expect(summary.usageMissing).toBe(true)
    expect(summary.tokens).toEqual({ inputMiss: 0, inputCacheHit: 0, output: 0, reasoning: 0 })
  })

  it('cap 只触发一次：压缩 Google 预算到 used、迭代上限收到 iteration+3，后续只读不重复注入', () => {
    const budget = createEnrichBudget()
    budget.places.used = 3
    budget.directions.used = 2
    const tracker = createRunCostTracker({ enrichBudget: budget, runCapMicros: 1_000, maxIterations: 12, withTitle: false })
    // 未达上限：不触发
    tracker.recordModelCall(modelMessage('deepseek-chat', { inputMiss: 10, inputCacheHit: 0, output: 0, reasoning: 0 }))
    const before = tracker.checkCap(1)
    expect(before).toEqual({ capReached: false, iterationLimit: 12 })
    expect(budget.places.max).toBe(40)
    // 巨额 usage 达到上限：触发
    tracker.recordModelCall(modelMessage('deepseek-chat', { inputMiss: 50_000_000, inputCacheHit: 0, output: 0, reasoning: 0 }))
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
    const empty = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 5, withTitle: false })
    const emptySummary = empty.summary()
    expect(emptySummary.usageMissing).toBe(true)
    expect(emptySummary.costMicros.total).toBe(0)
    expect(emptySummary.calls).toEqual({ placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 0 })

    const budget = createEnrichBudget()
    countGoogleCall(budget, 'directions')
    countGoogleCall(budget, 'placeDetails')
    const usage = { inputMiss: 1_000, inputCacheHit: 0, output: 100, reasoning: 0 }
    const withTitle = createRunCostTracker({ enrichBudget: budget, maxIterations: 5, withTitle: true })
    const withoutTitle = createRunCostTracker({ enrichBudget: budget, maxIterations: 5, withTitle: false })
    withTitle.recordModelCall(modelMessage('deepseek-chat', usage))
    withoutTitle.recordModelCall(modelMessage('deepseek-chat', usage))
    const a = withTitle.summary()
    const b = withoutTitle.summary()
    expect(a.calls).toEqual({ placesTextSearch: 0, placesNearby: 0, placeDetails: 1, directions: 1 })
    expect(b.costMicros.google).toBe(costOfGoogleCalls({ placesTextSearch: 0, placesNearby: 0, placeDetails: 1, directions: 1 }))
    expect(b.costMicros.model).toBe(costOfModelUsage('deepseek-chat', usage))
    expect(a.costMicros.model - b.costMicros.model).toBe(TITLE_OVERHEAD_MICROS)
    expect(a.costMicros.total - b.costMicros.total).toBe(TITLE_OVERHEAD_MICROS)
  })

  it('settle：回调一次 summary 与 hadModelOutput，回调抛错被吞掉', async () => {
    const tracker = createRunCostTracker({ enrichBudget: createEnrichBudget(), maxIterations: 5, withTitle: false })
    tracker.recordModelCall(modelMessage('deepseek-chat', { inputMiss: 100, inputCacheHit: 0, output: 10, reasoning: 0 }))
    const onRunCost = vi.fn(async (_summary: unknown, _hadModelOutput: boolean) => {})
    const summary = await tracker.settle(onRunCost)
    expect(onRunCost).toHaveBeenCalledTimes(1)
    expect(onRunCost.mock.calls[0]![0]).toBe(summary)
    expect(onRunCost.mock.calls[0]![1]).toBe(true)
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
