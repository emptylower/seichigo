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
    return [
      { id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' },
      { id: 'p2', name: '大吉山', nameZh: '大吉山', lat: 34.8871, lng: 135.8062, ep: '2' },
    ]
  },
  async getPointsByIds() {
    return [
      { id: 'p1', lat: 34.8892, lng: 135.8075 },
      { id: 'p2', lat: 34.8871, lng: 135.8062 },
    ]
  },
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage

function assistantMessage(partial: Partial<ChatMessage>): ChatMessage {
  return { role: 'assistant', content: null, refusal: null, ...partial } as ChatMessage
}

describe('runPlanAgent telemetry events', () => {
  it('emits reasoning deltas as reasoning events and keeps content as one final text event', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const createMessage = vi.fn(
      async (
        _params: { messages: unknown[]; tools: unknown[] },
        onDelta?: (d: { reasoning?: string; content?: string }) => void,
      ) => {
        onDelta?.({ reasoning: '思考A' })
        onDelta?.({ reasoning: '思考B' })
        onDelta?.({ content: '这段流式增量不应单独成事件' })
        return assistantMessage({ content: '安排好了！去宇治桥。' })
      },
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '帮我安排京吹一日巡礼',
      (e) => events.push(e),
    )

    const reasoningEvents = events.filter((e) => e.type === 'reasoning')
    expect(reasoningEvents).toEqual([
      { type: 'reasoning', delta: '思考A' },
      { type: 'reasoning', delta: '思考B' },
    ])
    // content 增量不转发，仍由完整 text 事件承载
    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents).toEqual([{ type: 'text', text: '安排好了！去宇治桥。' }])
    expect(events[events.length - 1].type).toBe('done')
  })

  it('emits status + tool_call running/done frames around each tool execution', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    // 第一轮调用工具，第二轮纯文本收尾
    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [
          {
            id: 'call_lp',
            type: 'function',
            function: { name: 'list_points', arguments: JSON.stringify({ bangumiId: 115908 }) },
          },
        ] as ChatMessage['tool_calls'],
      }),
      assistantMessage({ content: '找到了两个点位。' }),
    ]
    const createMessageSeq = vi.fn(async () => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage: createMessageSeq, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '帮我安排京吹一日巡礼',
      (e) => events.push(e),
    )

    const statuses = events.filter((e) => e.type === 'status')
    expect(statuses).toEqual([{ type: 'status', phase: '正在获取点位列表' }])

    const toolCallEvents = events.filter((e) => e.type === 'tool_call')
    expect(toolCallEvents).toHaveLength(2)
    const [running, done] = toolCallEvents as Extract<PlanAgentEvent, { type: 'tool_call' }>[]
    expect(running).toMatchObject({
      type: 'tool_call',
      id: 'call_lp',
      name: 'list_points',
      argsSummary: '作品 id 115908',
      status: 'running',
    })
    expect('durationMs' in running).toBe(false)
    expect('resultSummary' in running).toBe(false)
    expect(done).toMatchObject({
      type: 'tool_call',
      id: 'call_lp',
      name: 'list_points',
      argsSummary: '作品 id 115908',
      status: 'done',
      resultSummary: '找到 2 个点位',
    })
    expect(typeof done.durationMs).toBe('number')
    expect(done.durationMs).toBeGreaterThanOrEqual(0)

    // 顺序：status → running → done，且都在该轮 text 事件之前
    const idx = (type: string) => events.findIndex((e) => e.type === type)
    expect(idx('status')).toBeLessThan(events.findIndex((e) => e.type === 'tool_call'))
    expect(idx('tool_call')).toBeLessThan(idx('text'))
  })

  it('never persists status/tool_call/reasoning telemetry to the message history', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [
          {
            id: 'call_sp',
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
      assistantMessage({ content: '保存完成。' }),
    ]
    const createMessage = vi.fn(
      async (
        _params: { messages: unknown[]; tools: unknown[] },
        onDelta?: (d: { reasoning?: string; content?: string }) => void,
      ) => {
        onDelta?.({ reasoning: '想想怎么排' })
        return responses.shift() as ChatMessage
      },
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '安排一天巡礼',
      (e) => events.push(e),
    )

    expect(events.some((e) => e.type === 'reasoning')).toBe(true)
    expect(events.some((e) => e.type === 'status')).toBe(true)
    expect(events.some((e) => e.type === 'tool_call')).toBe(true)
    expect(events.some((e) => e.type === 'plan_updated')).toBe(true)

    const persisted = await repo.listMessages(plan.id)
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'tool', 'assistant'])
    const persistedJson = JSON.stringify(persisted.map((m) => m.content))
    // 遥测专属字段/内容绝不能混进落库消息（tool_call_id 是 OpenAI 协议必备键，不算遥测）
    expect(persistedJson).not.toContain('argsSummary')
    expect(persistedJson).not.toContain('resultSummary')
    expect(persistedJson).not.toContain('durationMs')
    expect(persistedJson).not.toContain('reasoning_content')
    expect(persistedJson).not.toContain('想想怎么排')
  })

  it('gives a generic status phrase and surfaces tool errors in resultSummary', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [
          {
            id: 'call_bad',
            type: 'function',
            function: { name: 'mystery_tool', arguments: '{"x":1}' },
          },
        ] as ChatMessage['tool_calls'],
      }),
      assistantMessage({ content: '呃，工具不存在。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      'hi',
      (e) => events.push(e),
    )

    expect(events).toContainEqual({ type: 'status', phase: '正在处理…' })
    const doneFrame = events.find(
      (e) => e.type === 'tool_call' && e.status === 'done',
    ) as Extract<PlanAgentEvent, { type: 'tool_call' }>
    expect(doneFrame.resultSummary).toBe('失败：未知工具: mystery_tool')
  })
})
