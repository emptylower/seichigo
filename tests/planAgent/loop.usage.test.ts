import { describe, expect, it, vi } from 'vitest'
import { runPlanAgent, type PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { attachLlmUsage } from '@/lib/llm/usage'
import { GOOGLE_PRICES_MICROS, PRICE_TABLE_VERSION } from '@/lib/billing/priceTable'
import { createEnrichBudget, countGoogleCall } from '@/lib/planAgent/enrich/types'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return []
  },
  async getPointsByIds() {
    return []
  },
}

describe('loop usage accounting', () => {
  it('sums usage across model calls and writes tokens/calls/cost into modelUsage', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const budget = createEnrichBudget()
    let call = 0
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> => {
      call += 1
      const message: PlanAgentChatMessage =
        call === 1
          ? {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_plan', arguments: '{}' } }],
            }
          : { role: 'assistant', content: '好的', refusal: null }
      // 第一次调用顺带模拟一次 Directions 外呼被计量
      if (call === 1) countGoogleCall(budget, 'directions')
      return attachLlmUsage(message, { inputMiss: 100, inputCacheHit: 900, output: 50, reasoning: 10 })
    })
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder, enrichBudget: budget }, maxIterations: 5 },
      '你好',
      () => {},
    )
    const logs = await repo.listRunLogs(plan.id)
    expect(logs).toHaveLength(1)
    const usage = logs[0].modelUsage as Record<string, any>
    expect(usage.tokens).toEqual({ inputMiss: 200, inputCacheHit: 1800, output: 100, reasoning: 20 })
    expect(usage.calls).toEqual({ placesTextSearch: 0, placesNearby: 0, placeDetails: 0, directions: 1 })
    expect(usage.modelCalls).toBe(2)
    expect(usage.usageMissing).toBe(false)
    expect(usage.costMicros.google).toBe(GOOGLE_PRICES_MICROS.directions)
    expect(usage.costMicros.total).toBe(usage.costMicros.model + usage.costMicros.google)
    expect(usage.priceTableVersion).toBe(PRICE_TABLE_VERSION)
  })

  it('marks usageMissing when a provider returned no usage', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> => ({ role: 'assistant', content: '好的', refusal: null }))
    await runPlanAgent({ createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 }, '你好', () => {})
    const [log] = await repo.listRunLogs(plan.id)
    expect((log.modelUsage as Record<string, any>).usageMissing).toBe(true)
  })

  it('F4：createMessage 抛错也计一次 modelCalls 并标 usageMissing', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> => {
      throw new Error('boom')
    })
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      '你好',
      () => {},
    )
    const [log] = await repo.listRunLogs(plan.id)
    const usage = log.modelUsage as Record<string, any>
    expect(usage.modelCalls).toBe(1)
    expect(usage.usageMissing).toBe(true)
  })
})
