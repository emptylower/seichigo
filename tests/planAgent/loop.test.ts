import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanRepo, TripPlanRunLogEntry } from '@/lib/tripPlan/repo'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { EMPTY_TURN_ERROR_MESSAGE, EMPTY_TURN_RETRY_INSTRUCTION } from '@/lib/planAgent/emptyTurn'
import { createEnrichBudget } from '@/lib/planAgent/enrich'
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
    // daymap 交付物随工具执行原子落库（在 assistant tool_calls 与 tool 回执之间）
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'daymap', 'tool', 'assistant'])
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
      // system + 历史里的 human（N5：阶段上下文拼进其内容前部）；本轮 human 消息只此一条
      const users = (params.messages as Array<{ role: string; content?: unknown }>).filter((m) => m.role === 'user')
      expect(users).toHaveLength(1)
      expect(String(users[0]!.content).endsWith('hi')).toBe(true)
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
    // 被接管的 run 不写运行日志（接管的 run 会写自己的日志）
    expect(await repo.listRunLogs(plan.id)).toHaveLength(0)
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
    expect(saved?.days).toHaveLength(0) // save_plan_days 的写必须被栅栏拦下（天数与 daymap 消息都不落）
    expect(events[events.length - 1].type).toBe('done')
    expect(events.some((e) => e.type === 'plan_updated')).toBe(false)
    expect(events.some((e) => e.type === 'daymap')).toBe(false)
    expect((await repo.listMessages(plan.id)).filter((m) => m.kind === 'daymap')).toHaveLength(0)
    // 被接管的 run 同样不留运行日志
    expect(await repo.listRunLogs(plan.id)).toHaveLength(0)
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

  it('空回合重试一次后仍为空：只发一条 EMPTY_TURN_ERROR_MESSAGE 的 error，不落任何空 assistant', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    // 两次都是"正文为空、无工具调用"（第二次用纯空白正文，覆盖 trim 分支）
    const responses: ChatMessage[] = [assistantMessage({ content: null }), assistantMessage({ content: '   ' })]
    const createMessage = vi.fn(async (_params: { messages: unknown[] }) => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      'hi',
      (e) => events.push(e),
    )

    // 有且只有一条 error，文案为空回合错误
    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents).toEqual([{ type: 'error', message: EMPTY_TURN_ERROR_MESSAGE }])
    // 第一次空回合发出重试遥测（复用既有 status 事件，不新增类型）
    expect(events).toContainEqual({ type: 'status', phase: '模型上一轮没有产出内容，正在让它精简思考重试' })
    expect(events[events.length - 1].type).toBe('done')

    // repo 上没有任何 content 为空且无 tool_calls 的 assistant 行
    const persisted = await repo.listMessages(plan.id)
    expect(persisted.map((m) => m.kind)).toEqual(['human'])
    const emptyAssistant = persisted.filter((m) => {
      if (m.kind !== 'assistant') return false
      const c = m.content as { role?: string; content?: unknown; tool_calls?: unknown[] }
      return c.role === 'assistant' && !Array.isArray(c.tool_calls) && (typeof c.content !== 'string' || !c.content.trim())
    })
    expect(emptyAssistant).toHaveLength(0)

    // 第二次调用的 messages 末尾是 EMPTY_TURN_RETRY_INSTRUCTION 的 user 消息
    expect(createMessage).toHaveBeenCalledTimes(2)
    const secondCallMessages = createMessage.mock.calls[1][0].messages as Array<{
      role: string
      content?: unknown
    }>
    const last = secondCallMessages[secondCallMessages.length - 1]
    expect(last).toEqual({ role: 'user', content: EMPTY_TURN_RETRY_INSTRUCTION })
  })

  it('空回合重试后带回工具调用：正常执行工具、不产生 error 事件，空 assistant 仍未落库', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({ content: null }),
      assistantMessage({
        tool_calls: [
          { id: 'call_lp', type: 'function', function: { name: 'list_points', arguments: JSON.stringify({ bangumiId: 115908 }) } },
        ] as ChatMessage['tool_calls'],
      }),
      assistantMessage({ content: '找到了 1 个点位。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      'hi',
      (e) => events.push(e),
    )

    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'list_points')).toBe(true)
    expect(events.some((e) => e.type === 'text' && e.text.includes('找到了'))).toBe(true)

    const persisted = await repo.listMessages(plan.id)
    // 空回合没有落库：只有 human、带 tool_calls 的 assistant、tool 回执、最终 text assistant
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'tool', 'assistant'])
    const emptyAssistant = persisted.filter((m) => {
      if (m.kind !== 'assistant') return false
      const c = m.content as { role?: string; content?: unknown; tool_calls?: unknown[] }
      return c.role === 'assistant' && !Array.isArray(c.tool_calls) && (typeof c.content !== 'string' || !c.content.trim())
    })
    expect(emptyAssistant).toHaveLength(0)
  })

  it('M4/N5：system 恒为原文；阶段上下文拼进内存中最新 human 消息前部（无连续 user 消息），落库仍是纯用户原文', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    let systemContent = ''
    let userMessages: Array<{ content?: unknown }> = []
    const createMessage = vi.fn(async (params: { messages: Array<{ role: string; content?: unknown }> }) => {
      const system = params.messages.find((m) => m.role === 'system')
      systemContent = String(system?.content ?? '')
      userMessages = params.messages.filter((m) => m.role === 'user')
      return assistantMessage({ content: '收到' })
    })

    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '帮我规划京吹巡礼',
      () => {},
    )

    const { PLAN_AGENT_SYSTEM_PROMPT } = await import('@/lib/planAgent/prompt')
    // system 消息不再被阶段上下文改写（保住前缀缓存），内容等于原文
    expect(systemContent).toBe(PLAN_AGENT_SYSTEM_PROMPT)
    // 不再单独插 [系统状态] user 消息：只有本轮这一条 user，阶段上下文拼在其前部
    expect(userMessages).toHaveLength(1)
    const lastUserContent = String(userMessages[0].content)
    expect(lastUserContent.startsWith('[系统状态]')).toBe(true)
    expect(lastUserContent).toContain('阶段：确认作品')
    expect(lastUserContent).toContain('[用户消息]')
    expect(lastUserContent.endsWith('帮我规划京吹巡礼')).toBe(true)
    // 该改写只在内存：落库历史里的 human 行是纯用户原文
    const persisted = await repo.listMessages(plan.id)
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant'])
    const humanRow = persisted[0]!.content as { role: string; content: string }
    expect(humanRow.content).toBe('帮我规划京吹巡礼')
    expect(JSON.stringify(persisted.map((m) => m.content))).not.toContain('[系统状态]')
    // 阶段缓存被回写
    expect((await repo.getPlan(plan.id))?.stage).toBe('works')
  })

  it('M4：run 结束写入运行日志（turnIndex/stage/toolCalls 摘要/时长）；保存过则带 enrich 与 gate 报告', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [
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
      assistantMessage({ content: '保存好了。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      '安排一天',
      () => {},
    )

    const logs = await repo.listRunLogs(plan.id)
    expect(logs).toHaveLength(1)
    const log = logs[0]!
    expect(log.turnIndex).toBe(1) // 第一条 human 消息
    expect(log.stage).toBe('works') // 保存前 bangumiIds 为空
    expect(log.toolCalls).toEqual([{ name: 'save_plan_days', durationMs: expect.any(Number) }])
    expect(log.durationMs).toBeGreaterThanOrEqual(0)
    // 本次 run 有过一次成功的 save：enrich/gate 报告进入日志
    const gate = log.gateReport as { passed: boolean; stats: { visitItems: number } } | null
    expect(gate?.passed).toBe(true)
    expect((log.enrichReport as { googleCallsUsed: { directions: number; places: number } } | null)?.googleCallsUsed).toEqual({
      directions: 0,
      places: 0,
    })
  })

  it('M4：同一 run 内多次 save 共享补齐预算——预算耗尽后第二次 save 不再外呼（skipped budget）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const twoPointFinder: PointFinder = {
      ...finder,
      async listPoints() {
        return [
          { id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' },
          { id: 'p2', name: '大吉山', nameZh: '大吉山', lat: 34.8963, lng: 135.8123, ep: '8' },
        ]
      },
      async getPointsByIds(ids: string[]) {
        const all = [
          { id: 'p1', lat: 34.8892, lng: 135.8075 },
          { id: 'p2', lat: 34.8963, lng: 135.8123 },
        ]
        return all.filter((p) => ids.includes(p.id))
      },
    }
    // 13 个点位 → 12 段缺口；注入收窄的预算（max=12）让第一次 save 恰好烧完
    // （R3 起默认 max=40，这里显式注入以继续覆盖耗尽边界）
    const enrichBudget = createEnrichBudget()
    enrichBudget.directions.max = 12
    const gapPoints = Array.from({ length: 13 }, (_, i) => ({
      type: 'point',
      pointId: i % 2 === 0 ? 'p1' : 'p2',
      title: `点位${i + 1}`,
    }))
    const saveCall = (id: string) => ({
      id,
      type: 'function' as const,
      function: {
        name: 'save_plan_days',
        arguments: JSON.stringify({ days: [{ dayIndex: 1, items: gapPoints }] }),
      },
    })

    const travel = vi.fn(async () => ({
      ok: true as const,
      mode: 'walking' as const,
      legs: [],
      durationSeconds: 480,
      distanceMeters: 600,
      transfers: 0,
      walkSeconds: 480,
      transitSeconds: 0,
      polyline: [],
    }))

    const responses: ChatMessage[] = [
      assistantMessage({ tool_calls: [saveCall('call_save_1')] as ChatMessage['tool_calls'] }),
      // 第二次 save：模型从头重新生成（未照抄第一次的 transit 行）
      assistantMessage({ tool_calls: [saveCall('call_save_2')] as ChatMessage['tool_calls'] }),
      assistantMessage({ content: '两次都保存好了。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: twoPointFinder, travel: travel as never, enrichBudget },
        maxIterations: 5,
      },
      '安排一天',
      (e) => events.push(e),
    )

    // 第一次 save 烧完 12 次预算；第二次 save 共享同一份预算 → 不再外呼
    expect(travel).toHaveBeenCalledTimes(12)
    expect(events.filter((e) => e.type === 'plan_updated')).toHaveLength(2)
    // 第二次 save 的工具回执里，缺口走零外呼估算兜底（A5：不留空、不记 budget skip）
    const toolReplies = (await repo.listMessages(plan.id)).filter((m) => m.kind === 'tool')
    const second = JSON.parse(String((toolReplies[1]!.content as { content: string }).content)) as {
      ok: boolean
      enrich: { applied: { transport: number }; skipped: Array<{ reason: string }> }
    }
    expect(second.ok).toBe(true)
    expect(second.enrich.applied.transport).toBe(12)
    expect(second.enrich.skipped.filter((s) => s.reason === 'budget')).toHaveLength(0)
  })

  // ---- S1/S3：补齐续跑的生产派发与派发门控 ----

  function saveCall(id: string, days: Array<{ dayIndex: number; items: unknown[] }>): NonNullable<ChatMessage['tool_calls']>[number] {
    return { id, type: 'function', function: { name: 'save_plan_days', arguments: JSON.stringify({ days }) } }
  }

  /** 保存后触发「预算已用完」缺口的素材：午餐无 place + places 预算归零 */
  const lunchGapDays = [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }, { type: 'meal', title: '午餐', payload: { mealSlot: 'lunch' } }] }]

  it('S1：未注入 deps.runInBackground 时缺省走 serverDeps 的 runInBackground——waitUntil 以 ctx 为 this 调用一次，且发生在 appendRunLog 之后', async () => {
    vi.useFakeTimers() // 续跑任务先 sleep 61s：挂起在假定时器上，不真实等待
    const CF = Symbol.for('__cloudflare-context__')
    const globalWithCf = globalThis as typeof globalThis & { [CF]?: unknown }
    const order: string[] = []
    const collected: Array<Promise<unknown>> = []
    const ctx: { waitUntil: (promise: Promise<unknown>) => void } = {
      waitUntil(promise) {
        expect(this).toBe(ctx) // 必须以 ctx 为 this 调用（脱离 ctx 抛 Illegal invocation，回归 R1）
        order.push('waitUntil')
        collected.push(promise)
      },
    }
    globalWithCf[CF] = { ctx }
    try {
      const repo = new MemoryTripPlanRepo()
      const plan = await repo.createPlan({ userId: 'u1', title: 't' })
      const enrichBudget = createEnrichBudget()
      enrichBudget.places.max = 0 // 唯一的午餐进入 budget skip → 需要补齐续跑
      const findRestaurants = vi.fn(async () => ({ ok: true as const, restaurants: [] }))
      const responses: ChatMessage[] = [
        assistantMessage({ tool_calls: [saveCall('call_save', lunchGapDays)] as ChatMessage['tool_calls'] }),
        assistantMessage({ content: '保存好了，餐厅稍后自动补上。' }),
      ]
      const createMessage = vi.fn(async () => responses.shift() as ChatMessage)
      const appendRunLog = vi.fn(async (entry: TripPlanRunLogEntry) => {
        order.push('appendRunLog')
        return repo.appendRunLog(entry)
      })
      const observedRepo: TripPlanRepo = new Proxy(repo, {
        get(target, prop, receiver) {
          if (prop === 'appendRunLog') return appendRunLog
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })

      await runPlanAgent(
        {
          createMessage,
          repo: observedRepo,
          planId: plan.id,
          toolDeps: { planId: plan.id, repo, points: finder, findRestaurants: findRestaurants as never, enrichBudget },
          maxIterations: 5,
        },
        '安排一天',
        () => {},
      )

      // 第一次 waitUntil 是 CUT-6 阶段缓存写（首模型请求后）；第二次才是补齐续跑
      expect(order).toEqual(['waitUntil', 'appendRunLog', 'waitUntil'])
      expect(collected).toHaveLength(2)
      expect((await repo.getPlan(plan.id))?.stage).toBe('works')
    } finally {
      delete globalWithCf[CF]
      vi.useRealTimers()
    }
  })

  it('S1：run 被接管（fenced）时不派发后台续跑——ctx.waitUntil 不被调用', async () => {
    const CF = Symbol.for('__cloudflare-context__')
    const globalWithCf = globalThis as typeof globalThis & { [CF]?: unknown }
    const waitUntil = vi.fn()
    globalWithCf[CF] = { ctx: { waitUntil } }
    try {
      const repo = new MemoryTripPlanRepo()
      const plan = await repo.createPlan({ userId: 'u1', title: 't' })
      const stale = await repo.beginAgentRun({ planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: -1000, content: { role: 'user', content: 'hi' } })
      if (stale.status !== 'ok') throw new Error('unreachable')
      const takeover = await repo.beginAgentRun({ planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000, content: { role: 'user', content: 'newer' } })
      if (takeover.status !== 'ok') throw new Error('unreachable')

    await runPlanAgent(
      {
        createMessage: vi.fn(async () => assistantMessage({ content: '来晚了' })),
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: stale.token,
      },
      'hi',
      () => {},
    )

    // 接管的 run 不派发补齐续跑；唯一的 waitUntil 是 CUT-6 阶段缓存写
    // （若派发的是续跑任务，await 会挂 61s 超时）；旧 token 被栅栏拦成 0 行
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0]![0]
    expect((await repo.getPlan(plan.id))?.stage).toBeNull()
    } finally {
      delete globalWithCf[CF]
    }
  })

  it('S3：最后一次保存未通过门控（quality.passed=false）→ 不派发补齐续跑', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const runInBackground = vi.fn()
    // attraction 无坐标是 hard 门控失败：保存被拒绝，整改是模型的活
    const responses: ChatMessage[] = [
      assistantMessage({ tool_calls: [saveCall('call_save', [{ dayIndex: 1, items: [{ type: 'attraction', title: '无坐标景点' }] }])] as ChatMessage['tool_calls'] }),
      assistantMessage({ content: '我修一下。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5, runInBackground },
      '安排一天',
      () => {},
    )

    // 门控未过 → 无补齐续跑；唯一派发是 CUT-6 缓存写（写下 stage='works'）
    expect(runInBackground).toHaveBeenCalledTimes(1)
    await runInBackground.mock.calls[0]![0]()
    expect((await repo.getPlan(plan.id))?.stage).toBe('works')
    expect((await repo.getPlan(plan.id))?.days).toHaveLength(0) // 保存本身也被拒绝
  })

  it('S3/S10：保存通过门控但评估报告无续跑缺口 → 跳过 getPlan 往返，不派发续跑', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const getPlan = vi.fn(() => repo.getPlan(plan.id))
    const observedRepo: TripPlanRepo = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === 'getPlan') return () => getPlan()
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const runInBackground = vi.fn()
    const responses: ChatMessage[] = [
      assistantMessage({ tool_calls: [saveCall('call_save', [{ dayIndex: 1, items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] }])] as ChatMessage['tool_calls'] }),
      assistantMessage({ content: '保存好了。' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    await runPlanAgent(
      { createMessage, repo: observedRepo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5, runInBackground },
      '安排一天',
      () => {},
    )

    // 唯一派发是 CUT-6 缓存写；无补齐续跑（否则 getPlan 多出续跑读取往返）
    expect(runInBackground).toHaveBeenCalledTimes(1)
    await runInBackground.mock.calls[0]![0]()
    expect((await repo.getPlan(plan.id))?.stage).toBe('works')
    expect(getPlan).toHaveBeenCalledTimes(1) // save 工具内部读取（阶段推断已走 getStageInputs）
  })
})
