import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PointFinder } from '@/lib/planAgent/points'
import type { TripPlanRunLiveRecord } from '@/lib/tripPlan/repo'

/**
 * 第七轮 A1：loop 的运行实况旁路写库——run 期间 upsertRunLive 被调用、
 * 正常结束后 clearRunLive；被接管的 run 也收尾但不 clear。
 */

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

describe('runPlanAgent 运行实况（第七轮 A1）', () => {
  it('run 期间把 reasoning/status/tool_call 写入运行实况，结束后 clearRunLive', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      since: new Date(0),
      limit: 100,
      busyTtlMs: 60_000,
      content: { role: 'user', content: 'hi' },
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const clear = vi.spyOn(repo, 'clearRunLive')

    const createMessage = vi.fn(
      async (_params: unknown, onDelta?: (delta: { reasoning?: string; content?: string }) => void) => {
        onDelta?.({ reasoning: '先想想去哪。' })
        return assistantMessage({ content: '安排好了。' })
      },
    )

    await runPlanAgent(
      {
        createMessage: createMessage as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: begin.token,
      },
      'hi',
      () => {},
    )

    expect(upsert).toHaveBeenCalled()
    const lastPatch = upsert.mock.calls.at(-1)![1]
    expect(lastPatch.runToken).toBe(begin.token)
    expect(lastPatch.reasoningReplace).toContain('先想想去哪。')
    expect(clear).toHaveBeenCalledWith(plan.id)
    expect(await repo.getRunLive(plan.id)).toBeNull()
  })

  it('M2：被接管的 run 收尾完全不写实况库（不 upsert、不 clear），也不写运行日志', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const stale = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      since: new Date(0),
      limit: 100,
      busyTtlMs: -1000,
      content: { role: 'user', content: 'hi' },
    })
    if (stale.status !== 'ok') throw new Error('unreachable')
    const takeover = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      since: new Date(0),
      limit: 100,
      busyTtlMs: 60_000,
      content: { role: 'user', content: 'newer' },
    })
    if (takeover.status !== 'ok') throw new Error('unreachable')

    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const clear = vi.spyOn(repo, 'clearRunLive')
    const createMessage = vi.fn(
      async (_params: unknown, onDelta?: (delta: { reasoning?: string; content?: string }) => void) => {
        onDelta?.({ reasoning: '来晚了但还在想。' })
        return assistantMessage({ content: '来晚了' })
      },
    )

    await runPlanAgent(
      {
        createMessage: createMessage as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: stale.token,
      },
      'hi',
      () => {},
    )

    // fenced run：finish(flush:false, clear:false)——未刷新的增量被丢弃，
    // 绝不以旧 token 落笔覆盖新 run 的实况行，也绝不清行、不写运行日志
    expect(upsert).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(await repo.getRunLive(plan.id)).toBeNull()
    expect(await repo.listRunLogs(plan.id)).toHaveLength(0)
  })

  it('M1：repo 写库 5 秒才 resolve 时，run 仍在 2.5 秒内收到 done（finish 不拖住 SSE 收尾）', async () => {
    vi.useFakeTimers()
    try {
      const repo = new MemoryTripPlanRepo()
      const plan = await repo.createPlan({ userId: 'u1', title: 't' })
      const begin = await repo.beginAgentRun({
        planId: plan.id,
        userId: 'u1',
        since: new Date(0),
        limit: 100,
        busyTtlMs: 60_000,
        content: { role: 'user', content: 'hi' },
      })
      if (begin.status !== 'ok') throw new Error('unreachable')
      // 库慢：upsertRunLive 挂起 ≥5 秒（这里直接永不 resolve）
      const neverResolves = new Promise<TripPlanRunLiveRecord>(() => {})
      vi.spyOn(repo, 'upsertRunLive').mockReturnValue(neverResolves)

      const events: string[] = []
      const createMessage = vi.fn(
        async (_params: unknown, onDelta?: (delta: { reasoning?: string; content?: string }) => void) => {
          onDelta?.({ reasoning: '先想想。' }) // 让 writer 有脏数据，finish 必须排队一次慢 flush
          return assistantMessage({ content: '安排好了。' })
        },
      )

      const runPromise = runPlanAgent(
        {
          createMessage: createMessage as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
          repo,
          planId: plan.id,
          toolDeps: { planId: plan.id, repo, points: finder },
          userMessagePersisted: true,
          runToken: begin.token,
        },
        'hi',
        (event) => {
          events.push(event.type)
        },
      )
      await vi.advanceTimersByTimeAsync(2_500)
      expect(events).toContain('done')
      await runPromise
    } finally {
      vi.useRealTimers()
    }
  })
})
