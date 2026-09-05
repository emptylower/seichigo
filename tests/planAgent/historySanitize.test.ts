import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { sanitizeHistoryForModel } from '@/lib/planAgent/historySanitize'
import { runPlanAgent } from '@/lib/planAgent/loop'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { PointFinder } from '@/lib/planAgent/points'

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

const brokenArgs = '{"days":[{"dayIndex":1,"items":[{"type":"point","pointId":"p1'

// 本文件两条路径都不触发点位工具（模型直接文本收尾），空实现只为满足类型
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

describe('sanitizeHistoryForModel', () => {
  it('非法 JSON 的 tool_calls arguments 被替换为占位符，id/name 保留', () => {
    const input: ChatMessageParam[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'save_plan_days', arguments: brokenArgs } },
        ],
      },
    ]
    const out = sanitizeHistoryForModel(input)
    const call = (out[0] as { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> })
      .tool_calls[0]
    expect(call.id).toBe('call_1')
    expect(call.function.name).toBe('save_plan_days')
    expect(call.function.arguments).toBe('{"_invalid_arguments":true}')
    // 纯函数：不改输入
    expect(
      ((input[0] as { tool_calls: Array<{ function: { arguments: string } }> }).tool_calls[0].function.arguments),
    ).toBe(brokenArgs)
  })

  it('合法 JSON 的 arguments 原样保留', () => {
    const valid = JSON.stringify({ days: [] })
    const out = sanitizeHistoryForModel([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'save_plan_days', arguments: valid } }],
      },
    ])
    const call = (out[0] as { tool_calls: Array<{ function: { arguments: string } }> }).tool_calls[0]
    expect(call.function.arguments).toBe(valid)
  })

  it('tool 回复按 tool_call_id 配对不变', () => {
    const input: ChatMessageParam[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'save_plan_days', arguments: brokenArgs } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"error":"参数不是合法 JSON"}' },
    ]
    const out = sanitizeHistoryForModel(input)
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"error":"参数不是合法 JSON"}' })
  })

  it('剥掉协议不认识的额外字段，只留 role/content/tool_calls/tool_call_id/name/reasoning_content', () => {
    const input = [
      {
        role: 'user',
        content: '选 B',
        answerTo: 'ask_1',
        answerValue: { optionIds: ['b'] },
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      {
        role: 'assistant',
        content: '好',
        finish_reason: 'stop',
        reasoning_content: '想想',
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok', extra: true },
    ] as unknown as ChatMessageParam[]
    const out = sanitizeHistoryForModel(input) as unknown as Array<Record<string, unknown>>
    expect(out[0]).toEqual({ role: 'user', content: '选 B' })
    expect(out[1]).toEqual({ role: 'assistant', content: '好', reasoning_content: '想想' })
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'ok' })
  })

  // A4 补充要求的 loop 集成路径：历史含非法参数时，发给 createMessage 的
  // messages 已清洗（loop.test.ts 已 740/750 行，按 loop.*.test.ts 专题拆分
  // 惯例把这条放进本文件）
  it('loop 集成：历史含非法工具参数时，发给 createMessage 的 messages 已清洗', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // DeepSeek 时期被截断的非法 arguments（工具层当时已回复"参数不是合法 JSON"）
    await repo.appendMessage(plan.id, 'assistant', {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_broken',
          type: 'function',
          function: { name: 'save_plan_days', arguments: brokenArgs },
        },
      ],
    })
    await repo.appendMessage(plan.id, 'tool', {
      role: 'tool',
      tool_call_id: 'call_broken',
      content: JSON.stringify({ error: '工具调用参数不是合法 JSON' }),
    })

    const sentMessages: unknown[] = []
    const createMessage = vi.fn(async (params: { messages: unknown[] }) => {
      sentMessages.push(params.messages)
      return { role: 'assistant', content: '好的' } as OpenAI.Chat.Completions.ChatCompletionMessage
    })

    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '继续',
      () => {},
    )

    const sent = sentMessages[0] as Array<{
      role: string
      tool_calls?: Array<{ id: string; function: { arguments: string } }>
    }>
    const broken = sent.find((m) => m.role === 'assistant' && m.tool_calls?.some((c) => c.id === 'call_broken'))
    expect(broken?.tool_calls?.[0]?.function.arguments).toBe('{"_invalid_arguments":true}')
    // 落库的历史保持原样（不改数据库里的消息）
    const persisted = await repo.listMessages(plan.id)
    const persistedBroken = persisted
      .map((m) => m.content as { role?: string; tool_calls?: Array<{ function: { arguments: string } }> })
      .find((c) => c.role === 'assistant' && c.tool_calls?.length)
    expect(persistedBroken?.tool_calls?.[0]?.function.arguments).toContain('"dayIndex":1')
  })
})
