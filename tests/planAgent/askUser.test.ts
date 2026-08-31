import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import type { Prisma } from '@prisma/client'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanRepo, TripPlanMessageKind } from '@/lib/tripPlan/repo'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import { AskUserSignal, planMetaFromAnswer } from '@/lib/planAgent/askUser'
import type { AskUserPayload } from '@/lib/planAgent/askUser'
import { toChatView } from '@/lib/tripPlan/view'
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

function askUserToolCall(overrides: Record<string, unknown> = {}, id = 'call_ask') {
  return {
    id,
    type: 'function' as const,
    function: {
      name: 'ask_user',
      arguments: JSON.stringify({ kind: 'date_range', prompt: '你打算什么时候出发？', ...overrides }),
    },
  }
}

describe('executePlanTool ask_user', () => {
  async function makeDeps(): Promise<{ deps: PlanAgentToolDeps }> {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    return { deps: { planId: plan.id, repo, points: finder } }
  }

  it('throws AskUserSignal carrying a generated askId and normalized payload', async () => {
    const { deps } = await makeDeps()
    const signal = await executePlanTool(
      deps,
      'ask_user',
      { kind: 'single_choice', prompt: '哪一部《吹响吧》？', allowSkip: true, options: [
        { id: 'a', label: '本传', sublabel: '47 个点位', image: 'https://example.com/a.jpg' },
        { id: 'b', label: '剧场版' },
      ] },
    ).then(
      () => null,
      (err: unknown) => err,
    )
    expect(signal).toBeInstanceOf(AskUserSignal)
    const payload = (signal as AskUserSignal).payload
    expect(payload.askId).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.kind).toBe('single_choice')
    expect(payload.prompt).toBe('哪一部《吹响吧》？')
    expect(payload.options).toEqual([
      { id: 'a', label: '本传', sublabel: '47 个点位', image: 'https://example.com/a.jpg' },
      { id: 'b', label: '剧场版' },
    ])
    expect(payload.allowSkip).toBe(true)
  })

  it('omits options for date_range and defaults allowSkip to absent (false)', async () => {
    const { deps } = await makeDeps()
    const signal: AskUserSignal = await executePlanTool(deps, 'ask_user', {
      kind: 'date_range',
      prompt: '什么时候去？',
    }).then(
      () => {
        throw new Error('should have thrown')
      },
      (err: unknown) => err as AskUserSignal,
    )
    expect(signal.payload.kind).toBe('date_range')
    expect(signal.payload.options).toBeUndefined()
    expect('allowSkip' in signal.payload).toBe(false)
  })

  it('returns JSON errors instead of throwing for invalid inputs', async () => {
    const { deps } = await makeDeps()
    const badKind = JSON.parse(await executePlanTool(deps, 'ask_user', { kind: 'free_text', prompt: 'x' }))
    expect(badKind.error).toBeTruthy()

    const noPrompt = JSON.parse(await executePlanTool(deps, 'ask_user', { kind: 'date_range', prompt: '  ' }))
    expect(noPrompt.error).toBeTruthy()

    const choiceNoOptions = JSON.parse(
      await executePlanTool(deps, 'ask_user', { kind: 'single_choice', prompt: '选一个' }),
    )
    expect(choiceNoOptions.error).toBeTruthy()

    const optionMissingLabel = JSON.parse(
      await executePlanTool(deps, 'ask_user', {
        kind: 'multi_choice',
        prompt: '选几个',
        options: [{ id: 'a' }],
      }),
    )
    expect(optionMissingLabel.error).toBeTruthy()
  })
})

describe('runPlanAgent ask_user interruption', () => {
  it('emits an ask event, persists kind=ask with the full payload, and stops calling the model', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const responses: ChatMessage[] = [
      assistantMessage({
        tool_calls: [askUserToolCall()] as ChatMessage['tool_calls'],
      }),
      // 不应被消费：ask_user 之后必须中断循环，不再发起下一次模型调用
      assistantMessage({ content: '不该出现的收尾' }),
    ]
    const createMessage = vi.fn(async () => responses.shift() as ChatMessage)

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      '帮我规划京吹巡礼',
      (e) => events.push(e),
    )

    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events[events.length - 1].type).toBe('done')

    const ask = events.find((e) => e.type === 'ask') as Extract<PlanAgentEvent, { type: 'ask' }> | undefined
    expect(ask).toBeDefined()
    expect(ask).toMatchObject({ type: 'ask', kind: 'date_range', prompt: '你打算什么时候出发？' })
    expect(ask?.askId).toMatch(/^[0-9a-f-]{36}$/)

    const persisted = await repo.listMessages(plan.id)
    expect(persisted.map((m) => m.kind)).toEqual(['human', 'assistant', 'ask', 'tool'])
    const askRow = persisted.find((m) => m.kind === 'ask')
    expect(askRow?.content).toMatchObject({
      askId: ask?.askId,
      kind: 'date_range',
      prompt: '你打算什么时候出发？',
    })
    // tool 回执让带 tool_calls 的 assistant 消息在回放时成组保留
    const receiptRow = persisted.find((m) => m.kind === 'tool')
    expect(receiptRow?.content).toMatchObject({ role: 'tool', tool_call_id: 'call_ask' })
  })

  it('passes options and allowSkip through to the ask event and persisted payload', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const options = [
      { id: 'a', label: '本传', sublabel: '47 个点位' },
      { id: 'b', label: '剧场版' },
    ]
    const createMessage = vi.fn(async () =>
      assistantMessage({
        tool_calls: [askUserToolCall({ kind: 'multi_choice', prompt: '想去哪几部？', options, allowSkip: true })] as ChatMessage['tool_calls'],
      }),
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '帮我规划',
      (e) => events.push(e),
    )

    const ask = events.find((e) => e.type === 'ask') as Extract<PlanAgentEvent, { type: 'ask' }>
    expect(ask.options).toEqual(options)
    expect(ask.allowSkip).toBe(true)

    const askRow = (await repo.listMessages(plan.id)).find((m) => m.kind === 'ask')
    expect((askRow?.content as AskUserPayload).options).toEqual(options)
    expect((askRow?.content as AskUserPayload).allowSkip).toBe(true)
  })

  it('keeps the replayable protocol group on the next run: assistant tool_calls + receipt survive, ask payload stays out of the model messages', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const firstCreate = vi.fn(async () =>
      assistantMessage({ tool_calls: [askUserToolCall()] as ChatMessage['tool_calls'] }),
    )
    await runPlanAgent(
      { createMessage: firstCreate, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '帮我规划京吹巡礼',
      () => {},
    )

    // 用户提交结构化回答后的下一轮：回放历史必须是合法的 OpenAI 协议序列
    const seenMessages: Array<{ role: string; tool_call_id?: string }> = []
    const secondCreate = vi.fn(async (params: { messages: unknown[] }) => {
      for (const m of params.messages as Array<{ role: string; tool_call_id?: string }>) seenMessages.push({ role: m.role, tool_call_id: m.tool_call_id })
      return assistantMessage({ content: '收到，开始规划。' })
    })
    await runPlanAgent(
      { createMessage: secondCreate, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '10月3日出发，10月6日返回，共4天',
      () => {},
    )

    // system + 上一轮 human + assistant(tool_calls) + tool 回执 + 本轮 human；ask 行（无 role）不进模型消息
    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user'])
    expect(seenMessages[3].tool_call_id).toBe('call_ask')
  })

  it('drops the ask persistence without an error event when the run is fenced right before the ask write', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const stale = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: -1000,
      content: { role: 'user', content: 'hi' },
    })
    if (stale.status !== 'ok') throw new Error('unreachable')

    // 恰好在 ask 落库那一刻被新请求接管（assistant 消息仍能写入）
    const fencedAskRepo: TripPlanRepo = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === 'appendMessageIfActive') {
          return async (planId: string, token: string, kind: TripPlanMessageKind, content: Prisma.JsonValue) => {
            if (kind === 'ask') {
              const takeover = await repo.beginAgentRun({
                planId, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000,
                content: { role: 'user', content: 'newer' },
              })
              if (takeover.status !== 'ok') throw new Error('unreachable')
            }
            return repo.appendMessageIfActive(planId, token, kind, content)
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const createMessage = vi.fn(async () =>
      assistantMessage({ tool_calls: [askUserToolCall()] as ChatMessage['tool_calls'] }),
    )
    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo: fencedAskRepo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo: fencedAskRepo, points: finder },
        userMessagePersisted: true,
        runToken: stale.token,
      },
      'hi',
      (e) => events.push(e),
    )

    expect(events.some((e) => e.type === 'ask')).toBe(false)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events[events.length - 1].type).toBe('done')
    expect((await repo.listMessages(plan.id)).filter((m) => m.kind === 'ask')).toHaveLength(0)
  })
})

describe('planMetaFromAnswer', () => {
  it('maps a precise date_range answer to startDate + dayCount', () => {
    const patch = planMetaFromAnswer('ask-1', { startDate: '2026-10-03', dayCount: 4 })
    expect(patch?.dayCount).toBe(4)
    expect(patch?.startDate).toEqual(new Date('2026-10-03'))
  })

  it('maps a fuzzy month answer to dayCount only', () => {
    const patch = planMetaFromAnswer('ask-1', { monthHint: '2026-10', dayCount: 3 })
    expect(patch).toEqual({ dayCount: 3 })
  })

  it('clamps dayCount into 1..30 and ignores invalid startDate', () => {
    expect(planMetaFromAnswer('a', { dayCount: 0 })).toEqual({ dayCount: 1 })
    expect(planMetaFromAnswer('a', { dayCount: 99 })).toEqual({ dayCount: 30 })
    expect(planMetaFromAnswer('a', { startDate: 'not-a-date', dayCount: 5 })).toEqual({ dayCount: 5 })
  })

  it('returns null for choice answers, missing answerTo, or non-object values', () => {
    expect(planMetaFromAnswer('a', { optionId: 'x' })).toBeNull()
    expect(planMetaFromAnswer('a', { optionIds: ['x'] })).toBeNull()
    expect(planMetaFromAnswer(undefined, { startDate: '2026-10-03', dayCount: 4 })).toBeNull()
    expect(planMetaFromAnswer('', { dayCount: 4 })).toBeNull()
    expect(planMetaFromAnswer('a', null)).toBeNull()
    expect(planMetaFromAnswer('a', '文本')).toBeNull()
    expect(planMetaFromAnswer('a', {})).toBeNull()
  })
})

describe('toChatView ask messages', () => {
  it('exposes kind=ask rows as assistant entries carrying the full payload for the frontend', () => {
    const entries = toChatView([
      {
        id: 'm1', planId: 'p1', kind: 'human', content: { role: 'user', content: '帮我规划' }, createdAt: new Date(),
      },
      {
        id: 'm2', planId: 'p1', kind: 'assistant', content: { role: 'assistant', content: null, tool_calls: [] }, createdAt: new Date(),
      },
      {
        id: 'm3', planId: 'p1', kind: 'ask',
        content: { askId: 'ask-1', kind: 'date_range', prompt: '什么时候出发？' } as unknown as Prisma.JsonValue,
        createdAt: new Date(),
      },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[1]).toEqual({
      role: 'assistant',
      text: '什么时候出发？',
      ask: { askId: 'ask-1', kind: 'date_range', prompt: '什么时候出发？' },
    })
  })
})
