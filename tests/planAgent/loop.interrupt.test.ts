import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import type { PointFinder } from '@/lib/planAgent/points'

/** 第八轮 A1：客户端断开（client_disconnected）的中断标记 + 2026-09-06 软截止 */

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

describe('runPlanAgent 中断标记（第八轮 A1）', () => {
  it('signal 以 client_disconnected 中止 → 运行日志 stage=interrupted、实况被清、无 done', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000,
      content: { role: 'user', content: 'hi' },
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const clear = vi.spyOn(repo, 'clearRunLive')

    // 客户端在工具执行期间断开（route 用 DOMException('client_disconnected') 作 reason）
    const controller = new AbortController()
    const abortingFinder: PointFinder = {
      ...finder,
      async listPoints(bangumiId, limit) {
        controller.abort(new DOMException('client_disconnected', 'AbortError'))
        return finder.listPoints(bangumiId, limit)
      },
    }
    // 超过 flushChars 阈值的 reasoning 增量 → writer 立刻排队落库，实况行确实存在
    const createMessage = vi.fn(
      async (_params: unknown, onDelta?: (delta: { reasoning?: string }) => void) => {
        onDelta?.({ reasoning: '先想想。'.repeat(120) })
        return assistantMessage({
          tool_calls: [
            { id: 'call_lp', type: 'function', function: { name: 'list_points', arguments: JSON.stringify({ bangumiId: 115908 }) } },
          ] as ChatMessage['tool_calls'],
        })
      },
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage: createMessage as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: abortingFinder },
        userMessagePersisted: true,
        runToken: begin.token,
        signal: controller.signal,
      },
      'hi',
      (e) => events.push(e),
    )

    // 无 done：SSE 已断开，不再向客户端收尾发事件（但落库照常）
    expect(events.some((e) => e.type === 'done')).toBe(false)
    // 断开前实况行确实写过、收尾时被清
    expect(upsert).toHaveBeenCalled()
    expect(clear).toHaveBeenCalledWith(plan.id)
    expect(await repo.getRunLive(plan.id)).toBeNull()
    // 运行日志：stage=interrupted，其余字段照常（turnIndex/工具摘要）
    const logs = await repo.listRunLogs(plan.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]!.stage).toBe('interrupted')
    expect(logs[0]!.turnIndex).toBe(1)
    expect(logs[0]!.toolCalls).toEqual([{ name: 'list_points', durationMs: expect.any(Number) }])
    // 落库照常：abort 前已产出的 assistant 带 tool_calls 与 tool 回执都在
    expect((await repo.listMessages(plan.id)).map((m) => m.kind)).toEqual(['human', 'assistant', 'tool'])
  })

  it('正常完成的 run 不写 interrupted（stage 照常、done 照发）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage: vi.fn(async () => assistantMessage({ content: '安排好了。' })),
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
      },
      '安排一天',
      (e) => events.push(e),
    )

    expect(events[events.length - 1].type).toBe('done')
    const logs = await repo.listRunLogs(plan.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]!.stage).not.toBe('interrupted')
  })

  it('signal 以无 reason 中止（服务端主动）不算 interrupted：照常 done 与正常 stage 日志', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const controller = new AbortController()
    const abortingFinder: PointFinder = {
      ...finder,
      async listPoints(bangumiId, limit) {
        controller.abort() // 无 reason：非客户端断开语义
        return finder.listPoints(bangumiId, limit)
      },
    }
    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage: vi.fn(async () =>
          assistantMessage({
            tool_calls: [
              { id: 'call_lp', type: 'function', function: { name: 'list_points', arguments: JSON.stringify({ bangumiId: 115908 }) } },
            ] as ChatMessage['tool_calls'],
          }),
        ) as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: abortingFinder },
        signal: controller.signal,
      },
      'hi',
      (e) => events.push(e),
    )

    expect(events.some((e) => e.type === 'done')).toBe(true)
    const logs = await repo.listRunLogs(plan.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]!.stage).not.toBe('interrupted')
  })

  it('软截止（deadlineAt 已过）：不调用模型、stage=interrupted、无 done', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id, userId: 'u1', since: new Date(0), limit: 100, busyTtlMs: 60_000,
      content: { role: 'user', content: 'hi' },
    })
    if (begin.status !== 'ok') throw new Error('unreachable')

    const createMessage = vi.fn()
    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage: createMessage as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: begin.token,
        deadlineAt: Date.now() - 1,
      },
      'hi',
      (e) => events.push(e),
    )

    expect(createMessage).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'done')).toBe(false)
    const logs = await repo.listRunLogs(plan.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]!.stage).toBe('interrupted')
    expect(logs[0]!.toolCalls).toEqual([])
  })

  it('软截止未到：正常跑完（deadlineAt 在远未来不影响行为）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage: vi.fn(async () => assistantMessage({ content: '安排好了。' })) as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        deadlineAt: Date.now() + 60_000,
      },
      '安排一天',
      (e) => events.push(e),
    )

    expect(events[events.length - 1].type).toBe('done')
    const logs = await repo.listRunLogs(plan.id)
    expect(logs[0]!.stage).not.toBe('interrupted')
  })
})
