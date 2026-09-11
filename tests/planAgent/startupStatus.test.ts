import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { startupStatusPhrase } from '@/lib/planAgent/startupStatus'
import { RunFencedError } from '@/lib/planAgent/runFence'
import type { PointFinder } from '@/lib/planAgent/points'

/** 2026-09-10 首帧优化：run 启动阶段在真实步骤上发 status 实况（任务二） */

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

describe('runPlanAgent 启动实况 status（首帧优化）', () => {
  it('启动阶段按真实步骤依次发三条 status（读取历史 → 核对进度 → 组织思路），都在首个 model_info/text 之前', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () => assistantMessage({ content: '安排好了。' }))

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder } },
      '帮我排一天',
      (e) => events.push(e),
    )

    const statuses = events.filter((e) => e.type === 'status') as Extract<PlanAgentEvent, { type: 'status' }>[]
    expect(statuses.map((s) => s.phase)).toEqual([
      startupStatusPhrase('readHistory', 'zh'),
      startupStatusPhrase('checkProgress', 'zh'),
      startupStatusPhrase('organize', 'zh'),
    ])
    // 组织思路在首次模型调用（model_info）之前发出——TTFT 黑屏期有真实状态
    const organizeIdx = events.findIndex((e) => e.type === 'status' && e.phase === startupStatusPhrase('organize', 'zh'))
    expect(organizeIdx).toBeGreaterThanOrEqual(0)
    expect(organizeIdx).toBeLessThan(events.findIndex((e) => e.type === 'model_info'))
    expect(organizeIdx).toBeLessThan(events.findIndex((e) => e.type === 'text'))
  })

  it('deps.locale 传入时启动 status 用站点语言（en）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage = vi.fn(async () => assistantMessage({ content: 'Done.' }))

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, locale: 'en' },
      'plan a day',
      (e) => events.push(e),
    )

    expect(events).toContainEqual({ type: 'status', phase: startupStatusPhrase('readHistory', 'en') })
    expect(events).toContainEqual({ type: 'status', phase: startupStatusPhrase('organize', 'en') })
  })

  it('持有 runToken 但启动即已被接管 → 不发启动 status、不写实况行（旧 token 不覆盖新 run 的实况行）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // 旧 run 的租约已过期，新请求已接管 busy 位——旧 run 此刻才从队列里启动
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
    const createMessage = vi.fn(async () => assistantMessage({ content: '来晚了' }))

    const events: PlanAgentEvent[] = []
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
      (e) => events.push(e),
    )

    // 启动 status 被 holdsRun 闸门拦下：SSE 不发、实况行不写
    expect(events.filter((e) => e.type === 'status')).toHaveLength(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('持有 busy 位的 run 正常发启动 status 并立刻落库（首条 status 不被节流吞掉）', async () => {
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
    const createMessage = vi.fn(
      async () => assistantMessage({ content: '安排好了。' }),
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

    // runLive 的强制 flush：首条启动 status 在首条 reasoning 之前就已落库。
    // 评审修正 3：readHistory 必须自己落一次库（被 checkProgress 合并掉的话，
    // 刷新恢复的客户端看不到「正在读取对话历史」）
    const firstPatch = upsert.mock.calls[0]![1]
    expect(firstPatch.statusText).toBe(startupStatusPhrase('readHistory', 'zh'))
  })
})

/**
 * 2026-09-11 D 部分 CUT-7：deferStartupRunLive（默认关，内联 SSE 路径不传）
 * ——启动段三条 status 的落库压成一次并后移到首轮 renewLease 之后的释放点。
 */
describe('CUT-7 deferStartupRunLive：启动段 flush 压缩后移', () => {
  async function beginHeldRun(repo: MemoryTripPlanRepo): Promise<{ planId: string; runToken: string }> {
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
    return { planId: plan.id, runToken: begin.token }
  }

  it('deferStartupRunLive: true → 启动段只落一次库（statusText=organize），且该次发生在 renewLease 与 createMessage 之后', async () => {
    const repo = new MemoryTripPlanRepo()
    const { planId, runToken } = await beginHeldRun(repo)

    const order: string[] = []
    const originalUpsert = repo.upsertRunLive.bind(repo)
    const upsert = vi.spyOn(repo, 'upsertRunLive').mockImplementation(async (planId, patch) => {
      order.push('upsert')
      return originalUpsert(planId, patch)
    })
    const createMessage = vi.fn(async () => {
      order.push('createMessage')
      return assistantMessage({ content: '安排好了。' })
    })

    await runPlanAgent(
      {
        createMessage: createMessage as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId,
        toolDeps: { planId, repo, points: finder },
        userMessagePersisted: true,
        runToken,
        deferStartupRunLive: true,
        renewLease: async () => {
          order.push('renewLease')
        },
      },
      'hi',
      () => {},
    )

    // 三条启动 status 压成一次落库，且落的是最新一条（organize）
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0]![1].statusText).toBe(startupStatusPhrase('organize', 'zh'))
    // 释放点锁死：flush 必须在首轮 renewLease 之后、createMessage 调用之后。
    // 有人把释放点前移到 renewLease 之前，这里就会先见到 upsert 而变红
    expect(order).toEqual(['renewLease', 'createMessage', 'upsert'])
  })

  it('deferStartupRunLive: true 且首轮 renewLease 即抛 RunFencedError → 三条 status 照常发 SSE，但一条实况也不落库', async () => {
    const repo = new MemoryTripPlanRepo()
    const { planId, runToken } = await beginHeldRun(repo)
    const upsert = vi.spyOn(repo, 'upsertRunLive')

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage: vi.fn(async () => assistantMessage({ content: '来晚了' })) as unknown as Parameters<
          typeof runPlanAgent
        >[0]['createMessage'],
        repo,
        planId,
        toolDeps: { planId, repo, points: finder },
        userMessagePersisted: true,
        runToken,
        deferStartupRunLive: true,
        renewLease: async () => {
          throw new RunFencedError()
        },
      },
      'hi',
      (e) => events.push(e),
    )

    // SSE 事件流逐字节不变（三条启动 status 照常发出）；被接管的 run 在
    // renewLease 就抛错，走不到释放点——一条实况也不落库
    expect(events.filter((e) => e.type === 'status')).toHaveLength(3)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('不传 deferStartupRunLive（内联 SSE 路径）→ 释放点是严格 no-op：仍三次 flush、首条 readHistory，无额外 upsert', async () => {
    const repo = new MemoryTripPlanRepo()
    const { planId, runToken } = await beginHeldRun(repo)
    const upsert = vi.spyOn(repo, 'upsertRunLive')

    await runPlanAgent(
      {
        createMessage: vi.fn(async () => assistantMessage({ content: '安排好了。' })) as unknown as Parameters<
          typeof runPlanAgent
        >[0]['createMessage'],
        repo,
        planId,
        toolDeps: { planId, repo, points: finder },
        userMessagePersisted: true,
        runToken,
      },
      'hi',
      () => {},
    )

    // 三条 status 各自强制 flush；afterModelRequestIssued 里的无条件
    // releaseStartupFlush() 未持有 → no-op，不产生第四次 upsert。
    // 评审修正 3 的回归闸门：P2-B 三读合一后两条启动 status 之间没了 DB 往返，
    // 一度被 writer 合并成 2 次、且首次落的是 checkProgress——readHistory 永不
    // 落库，刷新恢复的客户端看不到「正在读取对话历史」。loopPrelude 让出一拍
    // 微任务把排队的 flush 交出去后，首次落库重新是 readHistory。
    // （checkProgress 仍会并进 organize 那次：writer 的 chain 是串行的，首个
    // upsert 在途期间排队的 status 只会合并成一次，而前奏之后到 organize 之间
    // 也不再有 IO——这是三读合一的固有结果，不是本修正要解决的问题。）
    expect(upsert).toHaveBeenCalledTimes(3)
    expect(upsert.mock.calls[0]![1].statusText).toBe(startupStatusPhrase('readHistory', 'zh'))
    expect(upsert.mock.calls.at(-1)![1].statusText).toBe(startupStatusPhrase('organize', 'zh'))
  })
})
