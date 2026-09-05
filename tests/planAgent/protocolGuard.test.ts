import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { looksLikeUnansweredUserQuestion, assertNoOrphanToolCalls } from '@/lib/planAgent/protocolGuard'
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

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage

function assistantMessage(partial: Partial<ChatMessage>): ChatMessage {
  return { role: 'assistant', content: null, refusal: null, ...partial } as ChatMessage
}

function askUserToolCall(): ChatMessage['tool_calls'] {
  return [
    {
      id: 'call_ask',
      type: 'function',
      function: {
        name: 'ask_user',
        arguments: JSON.stringify({
          taskType: 'date_range',
          kind: 'date_range',
          prompt: '你打算什么时候出发？',
        }),
      },
    },
  ] as ChatMessage['tool_calls']
}

function readPlanToolCall(id = 'call_read'): ChatMessage['tool_calls'] {
  return [
    {
      id,
      type: 'function',
      function: { name: 'read_plan', arguments: '{}' },
    },
  ] as ChatMessage['tool_calls']
}

function searchAnimeToolCall(id: string): ChatMessage['tool_calls'] {
  return [
    {
      id,
      type: 'function',
      function: { name: 'search_anime', arguments: JSON.stringify({ query: '上低音号' }) },
    },
  ] as ChatMessage['tool_calls']
}

/** 扫一遍消息序列，返回所有"assistant 带 tool_calls 但紧随 tool 消息未覆盖"的悬空 id */
function findOrphanToolCallIds(
  messages: Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>,
): string[] {
  const orphans: string[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue
    const answered = new Set<string>()
    let j = i + 1
    while (j < messages.length && messages[j].role === 'tool') {
      const replyId = messages[j].tool_call_id
      if (replyId) answered.add(replyId)
      j++
    }
    for (const call of msg.tool_calls) {
      if (!answered.has(call.id)) orphans.push(call.id)
    }
  }
  return orphans
}

describe('looksLikeUnansweredUserQuestion（窄判定）', () => {
  it('命中：问号 + 指向用户的提问', () => {
    expect(looksLikeUnansweredUserQuestion('你打算什么时候出发？')).toBe(true)
    expect(looksLikeUnansweredUserQuestion('你是想去京都还是东京呢?')).toBe(true)
    expect(looksLikeUnansweredUserQuestion('告诉我你想去哪几部作品的作品名')).toBe(true)
    expect(looksLikeUnansweredUserQuestion('请提供你的出发日期')).toBe(true)
  })

  it('M3 修订：请问/麻烦告诉/能否提供 等客套疑问句式（无问号）也命中', () => {
    expect(looksLikeUnansweredUserQuestion('请问想先去京都还是东京')).toBe(true)
    expect(looksLikeUnansweredUserQuestion('请问出发日期和天数')).toBe(true)
    expect(looksLikeUnansweredUserQuestion('麻烦告诉我你们的出发城市')).toBe(true)
    expect(looksLikeUnansweredUserQuestion('能否提供一下大致预算')).toBe(true)
  })

  it('不命中：解释性/陈述性文字（即使带疑问词色彩）', () => {
    expect(looksLikeUnansweredUserQuestion('这样排是因为上午人少、光线好，下午再去山上。')).toBe(false)
    expect(looksLikeUnansweredUserQuestion('为什么把大吉山放第二天：因为当天要走山路，安排在体力好的早上。')).toBe(false)
    expect(looksLikeUnansweredUserQuestion('安排好了！Day1 去宇治桥。')).toBe(false)
    expect(looksLikeUnansweredUserQuestion('')).toBe(false)
  })

  it('不命中：引用用户原话作答的陈述句', () => {
    expect(looksLikeUnansweredUserQuestion('关于你之前提到的路线，我按公交方案重新排好了。')).toBe(false)
  })
})

describe('runPlanAgent 强制 ask_user 协议守卫', () => {
  it('纯文字提问：违规正文不发 SSE、不落库；重试改用 ask_user 后正常收尾', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({ content: '你打算什么时候出发？想去几天呢？' }),
      assistantMessage({ tool_calls: askUserToolCall() }),
    ]
    // messages 数组是循环持有的活引用，调用时快照角色序列再断言
    const seenRolesByCall: string[][] = []
    const lastMessageByCall: Array<{ role: string; content: string } | null> = []
    const createMessage = vi.fn(async (params: { messages: Array<{ role: string; content?: unknown }> }) => {
      seenRolesByCall.push(params.messages.map((m) => m.role))
      const last = params.messages[params.messages.length - 1]
      lastMessageByCall.push(last ? { role: last.role, content: String(last.content ?? '') } : null)
      return responses.shift() as ChatMessage
    })

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      '帮我规划京吹巡礼',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(2)
    // 重试调用前，消息序列末尾是纠正指令（只进模型消息，不落库）；
    // 本轮 human 的 [系统状态] 前缀拼在其内容前部（N5），无单独阶段 user 消息
    expect(seenRolesByCall[1]).toEqual(['system', 'user', 'assistant', 'user'])
    expect(lastMessageByCall[1]?.role).toBe('user')
    expect(lastMessageByCall[1]?.content).toContain('ask_user')

    // 违规正文被扣下：SSE 里没有它的 text 事件，也没有任何 error
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)).toEqual([])
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.some((e) => e.type === 'ask')).toBe(true)
    expect(events[events.length - 1].type).toBe('done')

    // 落库历史：违规正文与纠正指令都不在，只有 tool_calls 回合的协议组
    const persisted = await repo.listMessages(plan.id)
    expect(persisted.some((m) => JSON.stringify(m.content).includes('什么时候出发？想去几天'))).toBe(false)
    expect(persisted.some((m) => JSON.stringify(m.content).includes('协议提醒'))).toBe(false)
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'ask', 'tool'])
  })

  it('重试后仍是纯文字提问：只发可恢复协议错误（无 text 事件、零 assistant 落库）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const createMessage = vi.fn(async () => assistantMessage({ content: '你到底想去几天呢？' }))

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      '帮我规划',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(2)
    // 违规正文两次都被扣下：没有任何 text 事件
    expect(events.filter((e) => e.type === 'text')).toEqual([])
    const errorEvent = events.find((e) => e.type === 'error') as Extract<PlanAgentEvent, { type: 'error' }> | undefined
    expect(errorEvent).toBeDefined()
    expect(errorEvent?.message).toContain('协议')
    expect(events[events.length - 1].type).toBe('done')

    // 只有人类消息落库：两轮违规 assistant 正文全部被扣
    const persisted = await repo.listMessages(plan.id)
    expect(persisted.map((m) => m.kind)).toEqual(['human'])
  })

  it('回归：解释文字 + 非 ask 工具调用（无 ask_user）同样触发守卫并扣下整条响应', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      // 第一轮：正文在问用户 + read_plan —— 旧实现会因为"有工具调用"直接放行
      assistantMessage({ content: '先看一下当前计划。对了，你打算什么时候出发？', tool_calls: readPlanToolCall('call_read_1') }),
      // 重试：干净的解释 + 同样的工具调用
      assistantMessage({ content: '先看一下当前计划。', tool_calls: readPlanToolCall('call_read_2') }),
      // 工具回执后的收尾
      assistantMessage({ content: '当前计划还是空的。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      '帮我规划',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(3)
    // 第一轮被扣下：违规正文不出现在 SSE；read_plan 没有被执行（没有它的 tool_call 帧与回执）
    const textEvents = events.filter((e) => e.type === 'text') as Array<{ type: 'text'; text: string }>
    expect(textEvents.map((e) => e.text)).toEqual(['先看一下当前计划。', '当前计划还是空的。'])
    expect(events.some((e) => e.type === 'error')).toBe(false)
    const persisted = await repo.listMessages(plan.id)
    expect(persisted.some((m) => JSON.stringify(m.content).includes('什么时候出发'))).toBe(false)
    // 重试后的 read_plan 正常执行并落库回执
    const toolReceipt = persisted.find((m) => m.kind === 'tool')
    expect(JSON.stringify(toolReceipt?.content)).toContain('call_read_2')
    expect(persisted.some((m) => JSON.stringify(m.content).includes('call_read_1'))).toBe(false)
  })

  it('扣下"正文提问 + 工具调用"组合：重试请求的 messages 无悬空 tool_calls，第一次的 tool_calls 不在其中', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      // 2026-09-02 预览实测形态：正文在问用户 + search_anime 工具调用。
      // 旧实现把带 tool_calls 的 assistantParam 原样压进内存消息后 continue，
      // 工具未执行、也没有回执 → 下一次模型请求被 DeepSeek 400 拒掉
      assistantMessage({
        content: '你想巡礼哪些作品？',
        tool_calls: searchAnimeToolCall('call_search_1'),
      }),
      // 重试：干净的解释 + 正常工具调用
      assistantMessage({
        content: '先在站内搜一下相关作品。',
        tool_calls: searchAnimeToolCall('call_search_2'),
      }),
      assistantMessage({ content: '站内有《吹响吧！上低音号》的点位。' }),
    ]

    const messagesByCall: Array<Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>> = []
    const createMessage = vi.fn(
      async (
        params: { messages: Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }> },
      ) => {
        messagesByCall.push(params.messages.map((m) => ({ role: m.role, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id })))
        return responses.shift() as ChatMessage
      },
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      '帮我规划京吹巡礼',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(3)
    // 被扣下响应的 tool_calls（call_search_1）不出现在任何后续请求里：
    // 压进内存的副本只有 content，没有工具未执行的调用记录
    expect(JSON.stringify(messagesByCall[1])).not.toContain('call_search_1')
    expect(JSON.stringify(messagesByCall[2])).not.toContain('call_search_1')
    // 每次请求的消息序列都合法：不存在 assistant 带 tool_calls 且紧随回执未覆盖全部 id
    for (const msgs of messagesByCall) {
      expect(findOrphanToolCallIds(msgs)).toEqual([])
    }
    // 重试后的 search_anime 正常执行、正文正常下发；第一轮违规正文不进 SSE
    const textEvents = events.filter((e) => e.type === 'text') as Array<{ type: 'text'; text: string }>
    expect(textEvents.map((e) => e.text)).toEqual(['先在站内搜一下相关作品。', '站内有《吹响吧！上低音号》的点位。'])
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'search_anime')).toBe(true)
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('同一轮"解释文字 + ask_user 工具调用"不触发守卫（协议允许的组合）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const createMessage = vi.fn(async () =>
      assistantMessage({
        content: '站内有多部作品，需要先确认你想巡礼哪一部？',
        tool_calls: askUserToolCall(),
      }),
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 3 },
      '帮我规划',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.some((e) => e.type === 'ask')).toBe(true)
    // 解释文字与 ask 卡片并存（协议允许）
    expect(events.some((e) => e.type === 'text')).toBe(true)
  })

  it('正常陈述性结尾（无提问）不触发重试', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () => assistantMessage({ content: '行程已保存，第一天从宇治桥开始。' }))

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '帮我规划',
      (e) => events.push(e),
    )
    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.some((e) => e.type === 'text')).toBe(true)
  })
})

describe('assertNoOrphanToolCalls（内存消息完整性防线）', () => {
  type Msg = Parameters<typeof assertNoOrphanToolCalls>[0][number]

  function fnCall(id: string) {
    return { id, type: 'function' as const, function: { name: 'search_anime', arguments: '{}' } }
  }

  it('正例：assistant 带 tool_calls 而回执只覆盖一部分 → 在紧随的 tool 组末尾补缺失占位回执', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, tool_calls: [fnCall('c1'), fnCall('c2')] },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
      { role: 'user', content: 'next' },
    ]
    const result = assertNoOrphanToolCalls(messages)
    expect(result).toBe(messages) // 就地修复，返回同一引用
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user'])
    const repaired = messages[3] as { role: 'tool'; tool_call_id: string; content: string }
    expect(repaired.tool_call_id).toBe('c2')
    expect(JSON.parse(repaired.content)).toEqual({ error: expect.stringContaining('未被执行') })
  })

  it('正例：assistant 带 tool_calls 后完全没有 tool 消息 → 紧随其后插入，不打乱后续消息', () => {
    const messages: Msg[] = [
      { role: 'assistant', content: null, tool_calls: [fnCall('c1')] },
      { role: 'user', content: 'u' },
    ]
    assertNoOrphanToolCalls(messages)
    expect((messages[1] as { role: 'tool'; tool_call_id: string }).tool_call_id).toBe('c1')
    expect(messages[2]).toEqual({ role: 'user', content: 'u' })
  })

  it('反例：回执齐全的合法序列原样不变', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, tool_calls: [fnCall('c1')] },
      { role: 'tool', tool_call_id: 'c1', content: '{}' },
      { role: 'assistant', content: 'done' },
    ]
    const snapshot = JSON.stringify(messages)
    assertNoOrphanToolCalls(messages)
    expect(JSON.stringify(messages)).toBe(snapshot)
  })
})
