import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import type { PointFinder } from '@/lib/planAgent/points'

const finder: PointFinder = {
  async searchBangumi() {
    return [{ id: 115908, titleZh: '吹响吧！上低音号', titleJaRaw: null, city: '宇治' }]
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return [{ id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' }]
  },
  async getPointsByIds() {
    return [{ id: 'p1', lat: 34.8892, lng: 135.8075 }]
  },
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage

function assistantMessage(partial: Partial<ChatMessage>): ChatMessage {
  return { role: 'assistant', content: null, refusal: null, ...partial } as ChatMessage
}

describe('runPlanAgent', () => {
  it('executes tool calls, persists messages, and emits events', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'save_plan_days',
              arguments: JSON.stringify({
                days: [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] }],
              }),
            },
          },
        ] as ChatMessage['tool_calls'],
      }),
      assistantMessage({ content: '安排好了！Day1 去宇治桥。' }),
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
      },
      '帮我安排京吹一日巡礼',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(2)
    const saved = await repo.getPlan(plan.id)
    expect(saved?.days).toHaveLength(1)

    expect(events.some((e) => e.type === 'plan_updated')).toBe(true)
    expect(events.some((e) => e.type === 'text' && e.text.includes('宇治桥'))).toBe(true)
    expect(events[events.length - 1].type).toBe('done')

    const persisted = await repo.listMessages(plan.id)
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'tool', 'assistant'])
  })

  it('stops at maxIterations and still emits done', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () =>
      assistantMessage({
        tool_calls: [
          { id: 'call_x', type: 'function', function: { name: 'read_plan', arguments: '{}' } },
        ] as ChatMessage['tool_calls'],
      }),
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 3 },
      'hi',
      (e) => events.push(e),
    )
    expect(createMessage).toHaveBeenCalledTimes(3)
    expect(events[events.length - 1].type).toBe('done')
  })

  it('emits error event when the model call throws', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () => {
      throw new Error('rate limited')
    })
    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      'hi',
      (e) => events.push(e),
    )
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })

  it('does not duplicate the human message when userMessagePersisted is set', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 路由已原子落库人类消息（配额检查与落库同一事务）
    await repo.appendMessage(plan.id, 'human', { role: 'user', content: 'hi' })

    const createMessage = vi.fn(async (params: { messages: unknown[] }) => {
      // system + 历史里的 human，恰好各一条
      expect((params.messages as Array<{ role: string }>).filter((m) => m.role === 'user')).toHaveLength(1)
      return assistantMessage({ content: '收到' })
    })

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
      },
      'hi',
      (e) => events.push(e),
    )

    const persisted = await repo.listMessages(plan.id)
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant'])
  })

  it('sanitizes broken history: dangling tool_calls and orphan tool messages are dropped', async () => {
    const { sanitizeChatHistory } = await import('@/lib/planAgent/loop')
    const history = [
      { role: 'user', content: 'q1' },
      // 完整的一组：保留
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_plan', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{}' },
      // 悬空 tool_calls（崩溃/并发交错导致回执缺失）：丢弃
      { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'read_plan', arguments: '{}' } }] },
      { role: 'user', content: 'q2' },
      // 孤儿 tool 回执：丢弃
      { role: 'tool', tool_call_id: 'c9', content: '{}' },
      { role: 'assistant', content: '答复' },
    ] as Parameters<typeof sanitizeChatHistory>[0]

    const cleaned = sanitizeChatHistory(history)
    expect(cleaned.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user', 'assistant'])
  })

  it('stops without persisting once its run token has been superseded by a takeover', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    // 旧请求：TTL 极短立即过期（模拟模型响应慢，还没跑完循环，锁已经"看起来"死了）
    const stale = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: -1000,
      content: { role: 'user', content: 'hi' },
    })
    if (stale.status !== 'ok') throw new Error('unreachable')

    // 新请求趁虚接管
    const takeover = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000,
      content: { role: 'user', content: 'newer' },
    })
    if (takeover.status !== 'ok') throw new Error('unreachable')

    // 旧请求这时模型才终于返回——它必须发现自己已被顶替，不能再写历史
    const createMessage = vi.fn(async () => assistantMessage({ content: '来晚了' }))
    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: stale.token,
      },
      'hi',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(1)
    const persisted = await repo.listMessages(plan.id)
    expect(persisted.filter((m) => m.kind === 'assistant')).toHaveLength(0)
    expect(events[events.length - 1].type).toBe('done')
  })
})
