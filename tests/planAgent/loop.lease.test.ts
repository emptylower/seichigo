import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { RunFencedError } from '@/lib/planAgent/runFence'
import type { PointFinder } from '@/lib/planAgent/points'

/** 第九轮 L1：90 秒短租约——每次模型调用前与每次工具执行前续租 */

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

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage

function assistantMessage(partial: Partial<ChatMessage>): ChatMessage {
  return { role: 'assistant', content: null, refusal: null, ...partial } as ChatMessage
}

describe('runPlanAgent 租约续租（第九轮 L1）', () => {
  it('每次模型调用前与每次工具执行前都续租——一轮含 3 次工具调用 renew ≥ 4 次（模型前 1 + 工具前 3）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const renewLease = vi.fn(async () => {})

    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'read_plan', arguments: '{}' } },
          { id: 'c2', type: 'function', function: { name: 'read_plan', arguments: '{}' } },
          { id: 'c3', type: 'function', function: { name: 'read_plan', arguments: '{}' } },
        ] as ChatMessage['tool_calls'],
      }),
      assistantMessage({ content: '完成' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        maxIterations: 5,
        renewLease,
      },
      'hi',
      () => {},
    )

    // 第一次模型调用前 1 次 + 3 次工具执行前各 1 次 ≥ 4（第二次模型调用前还会 +1）
    expect(renewLease.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('被接管后续租抛 RunFencedError——run 静默收尾（fenced），工具不再执行', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 第一次续租（模型前）成功，第二次（工具前）发现已被接管
    const renewLease = vi.fn()
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new RunFencedError()
      })

    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_plan', arguments: '{}' } }] as ChatMessage['tool_calls'],
      }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        maxIterations: 5,
        renewLease,
      },
      'hi',
      (e) => events.push(e),
    )

    // 工具被拦下：没有 tool 回执落库、没有 error 事件（静默收尾）、无运行日志
    const persisted = await repo.listMessages(plan.id)
    expect(persisted.filter((m) => m.kind === 'tool')).toHaveLength(0)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events[events.length - 1].type).toBe('done')
    expect(await repo.listRunLogs(plan.id)).toHaveLength(0)
  })
})
