import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { runPlanAgent, type PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'
import { attachLlmUsage } from '@/lib/llm/usage'
import { createEnrichBudget } from '@/lib/planAgent/enrich/types'
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

describe('loop tier integration', () => {
  it('filters forbidden tools out of the model tool list and appends the tier note to the system prompt', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (params: { messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]; tools: OpenAI.Chat.Completions.ChatCompletionTool[] }): Promise<PlanAgentChatMessage> => {
      const names = params.tools.map((t) => ('function' in t ? t.function.name : ''))
      expect(names).not.toContain('estimate_travel')
      expect(names).not.toContain('find_restaurants')
      expect(names).toContain('estimate_transit')
      expect(String(params.messages[0].content)).toContain('[档位限制]')
      return { role: 'assistant', content: '好', refusal: null }
    })
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, entitlements: TIER_ENTITLEMENTS.free, maxIterations: 3 },
      '你好',
      () => {},
    )
    expect(createMessage).toHaveBeenCalledTimes(1)
  })

  it('applies tier budget maxima to the enrich budget it is given', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> => ({ role: 'assistant', content: '好', refusal: null }))
    const budget = createEnrichBudget()
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder, enrichBudget: budget }, entitlements: TIER_ENTITLEMENTS.free, maxIterations: 2 },
      '你好',
      () => {},
    )
    expect({ places: budget.places.max, directions: budget.directions.max }).toEqual({ places: 15, directions: 0 })
  })

  it('calls onRunCost once with the run summary and whether the model produced output', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> =>
      attachLlmUsage({ role: 'assistant', content: '好', refusal: null }, { inputMiss: 10, inputCacheHit: 0, output: 5, reasoning: 0 }),
    )
    const onRunCost = vi.fn(async (_summary: { costMicros: { total: number } }, _hadModelOutput: boolean) => {})
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, onRunCost, maxIterations: 2 },
      '你好',
      () => {},
    )
    expect(onRunCost).toHaveBeenCalledTimes(1)
    const [summary, hadModelOutput] = onRunCost.mock.calls[0]!
    expect(hadModelOutput).toBe(true)
    expect(summary.costMicros.total).toBeGreaterThan(0)
  })

  it('stops issuing new model calls two iterations after the run cap is reached', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 每次调用都返回一个 read_plan 工具调用，使循环持续；usage 巨大使第一轮就超上限
    const createMessage = vi.fn(async (): Promise<PlanAgentChatMessage> =>
      attachLlmUsage(
        {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [{ id: `c${Math.random()}`, type: 'function', function: { name: 'read_plan', arguments: '{}' } }],
        },
        { inputMiss: 50_000_000, inputCacheHit: 0, output: 0, reasoning: 0 },
      ),
    )
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, runCapMicros: 1, maxIterations: 12 },
      '你好',
      () => {},
    )
    // 第 1 次调用触发上限 → 最多再允许 2 次
    expect(createMessage.mock.calls.length).toBeLessThanOrEqual(3)
  })
})
