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

  it('maps transient network errors (workerd "Network connection lost.") to the friendly Chinese message', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () => {
      throw new TypeError('Network connection lost.')
    })
    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      'hi',
      (e) => events.push(e),
    )
    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toMatchObject({ type: 'error', message: expect.stringContaining('网络连接不稳定') })
    // 不再把原始英文技术文案直接甩给用户
    expect((errorEvent as { message: string }).message).not.toContain('Network connection lost')
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

  it('fences a tool mutation (save_plan_days) mid-iteration if superseded before the write lands', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const stale = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: -500,
      content: { role: 'user', content: 'hi' },
    })
    if (stale.status !== 'ok') throw new Error('unreachable')

    // 模型这一轮返回不慢（assistant 消息能正常落库——因为此时还没人接管，
    // 只是 busy 位的 TTL 太短已经"看起来"过期了；直到 list_points 执行
    // 时才真的有新请求趁虚接管），
    // 但同一轮里排在 save_plan_days 前面的那个工具调用（这里用
    // list_points 模拟，现实中通常是耗时的网络调用如 search_bangumi_tv）
    // 执行期间被真实接管——排在它后面的 save_plan_days 必须被栅栏拦下
    const tookOverDuringTool: PointFinder = {
      ...finder,
      async listPoints(bangumiId, limit) {
        const takeover = await repo.beginAgentRun({
          planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000,
          content: { role: 'user', content: 'newer' },
        })
        if (takeover.status !== 'ok') throw new Error('unreachable')
        return finder.listPoints(bangumiId, limit)
      },
    }

    const createMessage = vi.fn(async () =>
      assistantMessage({
        tool_calls: [
          {
            id: 'call_list',
            type: 'function',
            function: { name: 'list_points', arguments: JSON.stringify({ bangumiId: 115908 }) },
          },
          {
            id: 'call_save',
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
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: tookOverDuringTool },
        userMessagePersisted: true,
        runToken: stale.token,
        maxIterations: 5,
      },
      'hi',
      (e) => events.push(e),
    )

    const saved = await repo.getPlan(plan.id)
    expect(saved?.days).toHaveLength(0) // save_plan_days 的写必须被栅栏拦下
    expect(events[events.length - 1].type).toBe('done')
    expect(events.some((e) => e.type === 'plan_updated')).toBe(false)
  })

  it('工具调用参数是畸形 JSON 时返回显式解析错误，而不是把空对象喂给工具产生误导报错', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    // 模拟超长 tool call 被模型输出长度截断：arguments 是断在半截的 JSON
    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [
          {
            id: 'call_truncated',
            type: 'function',
            function: {
              name: 'save_plan_days',
              arguments: '{"days":[{"dayIndex":1,"items":[{"type":"fr',
            },
          },
        ] as ChatMessage['tool_calls'],
      }),
      assistantMessage({ content: '参数坏了，我重新生成。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      'hi',
      () => {},
    )

    const persisted = await repo.listMessages(plan.id)
    const toolReply = persisted.find((m) => m.kind === 'tool')
    expect(toolReply).toBeTruthy()
    // 落库的 content 是完整 toolParam { role, tool_call_id, content }，结果串在内层
    const inner = (toolReply!.content as { content?: unknown }).content
    const parsed = JSON.parse(String(inner)) as { error?: string }
    // 旧实现这里静默降级成 {}，save_plan_days 会报出误导性的"days 必须是数组"，
    // 诱导模型原样重发巨量参数；必须显式说明参数本身不是合法 JSON
    expect(parsed.error).toContain('不是合法 JSON')
    // 计划未被写入
    expect((await repo.getPlan(plan.id))?.days).toHaveLength(0)
  })
})
