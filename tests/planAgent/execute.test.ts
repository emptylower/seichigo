import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'

/**
 * Task A1：执行器抽取。executePlanAgentRun 承接 route 里的 deps 组装、
 * renewLease、标题侧信道与 finally { endAgentRun }——SSE 路径与队列内部
 * 路由共用同一份执行体。
 */

vi.mock('@/lib/planAgent/api', () => ({
  createChatCompletion: vi.fn(),
  generatePlanTitle: vi.fn(async () => null),
  withModelUsageInRunLog: vi.fn((repo: unknown) => repo),
  describePlanAgentModel: vi.fn(() => ({ providerName: '测试模型', model: 'test-model' })),
}))

vi.mock('@/lib/planAgent/serverDeps', () => ({
  getPlanAgentServerDeps: vi.fn(() => ({})),
  runInBackground: vi.fn(),
}))

import { createChatCompletion } from '@/lib/planAgent/api'
import { executePlanAgentRun, AGENT_BUSY_TTL_MS } from '@/lib/planAgent/execute'

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

async function run(repo: MemoryTripPlanRepo, planId: string, token: string) {
  const events: PlanAgentEvent[] = []
  await executePlanAgentRun({
    repo,
    planId,
    runToken: token,
    locale: 'zh',
    message: '帮我排一天',
    resume: false,
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    busyTtlMs: AGENT_BUSY_TTL_MS,
  })
  return events
}

describe('executePlanAgentRun（Task A1 执行器抽取）', () => {
  beforeEach(() => {
    vi.mocked(createChatCompletion).mockReset()
  })

  it('跑通一轮纯文本回复：onEvent 收到 text 与 done，结束后 busy 释放', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginRun(repo, plan.id)
    vi.mocked(createChatCompletion).mockResolvedValue({
      role: 'assistant',
      content: '安排好了。',
      refusal: null,
    })
    expect(await repo.isAgentBusy(plan.id)).toBe(true)

    const events = await run(repo, plan.id, begin.token)

    expect(events.some((e) => e.type === 'text')).toBe(true)
    expect(events[events.length - 1]!.type).toBe('done')
    expect(await repo.isAgentBusy(plan.id)).toBe(false)
    // 模型回复照常落库
    const kinds = (await repo.listMessages(plan.id)).map((m) => m.kind)
    expect(kinds).toEqual(['human', 'assistant'])
  })

  it('createMessage 抛错：onEvent 收到 error，busy 仍被释放', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginRun(repo, plan.id)
    vi.mocked(createChatCompletion).mockRejectedValue(new Error('上游炸了'))

    const events = await run(repo, plan.id, begin.token)

    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(await repo.isAgentBusy(plan.id)).toBe(false)
  })

  it('AGENT_BUSY_TTL_MS 保持 90 秒', () => {
    expect(AGENT_BUSY_TTL_MS).toBe(90 * 1000)
  })
})
