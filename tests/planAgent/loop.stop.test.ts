import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runPlanAgent } from '@/lib/planAgent/loop'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { RunFencedError } from '@/lib/planAgent/runFence'
import { canResume, inferInterrupted } from '@/lib/planAgent/resume'
import type { PointFinder } from '@/lib/planAgent/points'

/** 第十一轮 A3：停止（§0：停止是一等服务端语义，不是断开连接） */

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

describe('runPlanAgent 停止', () => {
  async function beginRun(repo: MemoryTripPlanRepo, planId: string) {
    const begin = await repo.beginAgentRun({
      planId,
      userId: 'u1',
      content: { role: 'user', content: '帮我排一天' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 10 * 60 * 1000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    return begin
  }

  it('模型流式中被停止 → 事件序列 …, stopped, done，日志 stage=stopped，实况行清空', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginRun(repo, plan.id)

    // 模型调用挂起直到 abort；被调起的同时用户按下停止（清 token + 写标记）
    const createMessage = vi.fn(
      (params: { signal?: AbortSignal }) =>
        new Promise<ChatMessage>((_, reject) => {
          const abort = () => reject(new DOMException('user_stopped', 'AbortError'))
          if (params.signal?.aborted) {
            abort()
            return
          }
          params.signal?.addEventListener('abort', abort)
          void repo.stopAgentRun(plan.id)
        }),
    )

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: begin.token,
        isStopped: () => repo.isAgentRunStopped(plan.id, begin.token),
      },
      '帮我排一天',
      (e) => events.push(e),
    )

    const types = events.map((e) => e.type)
    expect(types.indexOf('stopped')).toBeGreaterThanOrEqual(0)
    expect(types[types.length - 2]).toBe('stopped')
    expect(types[types.length - 1]).toBe('done')
    expect(types).not.toContain('error')

    // 运行日志 stage=stopped；实况行清空；不写 interrupted
    const logs = await repo.listRunLogs(plan.id)
    expect(logs.map((l) => l.stage)).toEqual(['stopped'])
    expect(await repo.getRunLive(plan.id)).toBeNull()

    // §0：停止后不自动续跑（inferInterrupted=null），但手动 resume 仍允许
    const messages = await repo.listMessages(plan.id)
    expect(inferInterrupted(messages, logs)).toBeNull()
    expect(canResume(messages, logs)).toBe(true)
  })

  it('续租发现被停止（RunFencedError + 停止标记）→ 同样走 stopped 收尾', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginRun(repo, plan.id)
    // 循环开跑前用户已停止：第一次 renewLease 就会被拒
    await repo.stopAgentRun(plan.id)

    const renewLease = vi.fn(async () => {
      const renewed = await repo.renewAgentRun(plan.id, begin.token, 60_000)
      if (!renewed) throw new RunFencedError()
    })

    const events: PlanAgentEvent[] = []
    await runPlanAgent(
      {
        createMessage: vi.fn(async () => assistantMessage({ content: '不该被调用' })),
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        userMessagePersisted: true,
        runToken: begin.token,
        renewLease,
      },
      '帮我排一天',
      (e) => events.push(e),
    )

    expect(renewLease).toHaveBeenCalled()
    const types = events.map((e) => e.type)
    expect(types[types.length - 2]).toBe('stopped')
    expect(types[types.length - 1]).toBe('done')
    expect((await repo.listRunLogs(plan.id)).map((l) => l.stage)).toEqual(['stopped'])
  })

  it('H2：实况标记行被清但同 token 的 stopped 日志存在 → 仍发 stopped/done 且不重复写日志', async () => {
    // 假时钟保证 stopped 日志与 human 消息时间戳严格分离（真实库为微秒精度）
    vi.useFakeTimers({ now: new Date('2026-09-04T00:00:00.000Z') })
    try {
      const repo = new MemoryTripPlanRepo()
      const plan = await repo.createPlan({ userId: 'u1', title: 't' })
      const begin = await beginRun(repo, plan.id)
      // 用户停止（stopAgentRun 落持久 stopped 日志 + 标记行），随后标记行被
      // 并发 GET 清掉（H2.2 只保 5 分钟）——loop 归属判定改读持久日志
      vi.setSystemTime(new Date('2026-09-04T00:00:01.000Z'))
      await repo.stopAgentRun(plan.id)
      await repo.clearRunLive(plan.id)

      const renewLease = vi.fn(async () => {
        const renewed = await repo.renewAgentRun(plan.id, begin.token, 60_000)
        if (!renewed) throw new RunFencedError()
      })

      const events: PlanAgentEvent[] = []
      await runPlanAgent(
        {
          createMessage: vi.fn(async () => assistantMessage({ content: '不该被调用' })),
          repo,
          planId: plan.id,
          toolDeps: { planId: plan.id, repo, points: finder },
          userMessagePersisted: true,
          runToken: begin.token,
          renewLease,
        },
        '帮我排一天',
        (e) => events.push(e),
      )

      expect(renewLease).toHaveBeenCalled()
      const types = events.map((e) => e.type)
      expect(types[types.length - 2]).toBe('stopped')
      expect(types[types.length - 1]).toBe('done')
      expect(types).not.toContain('error')
      // stopAgentRun 已写过同 token 的 stopped 日志 → loop 收尾不再重复写
      const logs = await repo.listRunLogs(plan.id)
      expect(logs.filter((l) => l.stage === 'stopped')).toHaveLength(1)
      // 停止后不自动续跑（inferInterrupted=null），但手动 resume 仍允许
      const messages = await repo.listMessages(plan.id)
      expect(inferInterrupted(messages, logs)).toBeNull()
      expect(canResume(messages, logs)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('model_info：每回合第一次模型调用结束后发送（reasoning=本次是否收到思考增量）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const responses: ChatMessage[] = [assistantMessage({ content: '第一轮' }), assistantMessage({ content: '第二轮' })]
    let call = 0
    const createMessage = vi.fn(async (_params: unknown, onDelta?: (d: { reasoning?: string }) => void) => {
      call += 1
      // 只在第一轮收到思考增量
      if (call === 1) onDelta?.({ reasoning: '思考一点' })
      return responses.shift() as ChatMessage
    })

    const events: PlanAgentEvent[] = []
    // maxIterations 2 但第二轮响应无工具调用即自然结束
    await runPlanAgent(
      {
        createMessage: createMessage as unknown as Parameters<typeof runPlanAgent>[0]['createMessage'],
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        maxIterations: 2,
      },
      'hi',
      (e) => events.push(e),
    )

    // env 路径回退描述（L3：不把内部路径名 'env' 露给用户）；reasoning 反映第一轮
    const infos = events.filter((e) => e.type === 'model_info')
    expect(infos).toHaveLength(1)
    const info = infos[0] as { providerName: string; model: string; reasoning: boolean }
    expect(info.providerName).toBe('默认模型')
    expect(typeof info.model).toBe('string')
    expect(info.reasoning).toBe(true)
  })
})
