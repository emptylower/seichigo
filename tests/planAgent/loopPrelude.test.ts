import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { runStartupPrelude } from '@/lib/planAgent/loopPrelude'
import { startupStatusPhrase } from '@/lib/planAgent/startupStatus'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'

/**
 * P2-B（2026-09-11）：runStartupPrelude 改为单次 getStartupRead
 * （1 条 SQL 替代 isAgentRunStopped + listMessages + getStageInputs 三次往返）。
 */

async function heldRun(repo: MemoryTripPlanRepo) {
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const begin = await repo.beginAgentRun({
    planId: plan.id,
    userId: 'u1',
    content: { role: 'user', content: 'hi' },
    since: new Date(0),
    limit: 10,
    busyTtlMs: 60_000,
  })
  if (begin.status !== 'ok') throw new Error('unreachable')
  return { plan, token: begin.token }
}

function runPrelude(
  repo: MemoryTripPlanRepo,
  planId: string,
  options: { runToken?: string; userMessagePersisted?: boolean; events?: PlanAgentEvent[] } = {},
) {
  return runStartupPrelude({
    repo,
    planId,
    runToken: options.runToken,
    userMessage: '帮我排一天',
    userMessagePersisted: options.userMessagePersisted,
    emit: (e) => options.events?.push(e),
    locale: 'zh',
  })
}

describe('runStartupPrelude（P2-B：单次 getStartupRead）', () => {
  it('读抛错 → 传播（不再吞错——与旧 listMessages 的致命语义一致）', async () => {
    const repo = new MemoryTripPlanRepo()
    const { plan } = await heldRun(repo)
    vi.spyOn(repo, 'getStartupRead').mockRejectedValue(new Error('db down'))
    await expect(runPrelude(repo, plan.id)).rejects.toThrow('db down')
  })

  it('单次往返：只调 getStartupRead 一次，不再调 isAgentRunStopped / listMessages / getStageInputs', async () => {
    const repo = new MemoryTripPlanRepo()
    const { plan, token } = await heldRun(repo)
    const startupRead = vi.spyOn(repo, 'getStartupRead')
    const stopped = vi.spyOn(repo, 'isAgentRunStopped')
    const listMessages = vi.spyOn(repo, 'listMessages')
    const stageInputs = vi.spyOn(repo, 'getStageInputs')

    const result = await runPrelude(repo, plan.id, { runToken: token, userMessagePersisted: true })

    expect(startupRead).toHaveBeenCalledTimes(1)
    expect(stopped).not.toHaveBeenCalled()
    expect(listMessages).not.toHaveBeenCalled()
    expect(stageInputs).not.toHaveBeenCalled()
    // beginAgentRun 已落库 human 消息 → stageHistory 含它
    expect(result.stageHistory.map((m) => m.kind)).toEqual(['human'])
  })

  it('read=null（计划已删）→ holdsRun=false（无 status）、history=[]、stageInputs 语义为 null（stage=works、pendingStageWrite=null）', async () => {
    const repo = new MemoryTripPlanRepo()
    const events: PlanAgentEvent[] = []
    const result = await runPrelude(repo, 'missing-plan', {
      runToken: 'tok',
      userMessagePersisted: true,
      events,
    })
    expect(events).toEqual([])
    expect(result.stageHistory).toEqual([])
    expect(result.stage).toBe('works')
    expect(result.stageContext).toBe('')
    expect(result.pendingStageWrite).toBeNull()
  })

  it('token 不匹配（已被接管）→ holdsRun=false：一条 status 都不发', async () => {
    const repo = new MemoryTripPlanRepo()
    const { plan } = await heldRun(repo)
    const events: PlanAgentEvent[] = []

    const result = await runPrelude(repo, plan.id, {
      runToken: 'stale-token',
      userMessagePersisted: true,
      events,
    })

    expect(events).toEqual([])
    // 前奏照常返回（历史在，只是不再代表本 run 持有）
    expect(result.stageHistory.length).toBeGreaterThan(0)
  })

  it('token 匹配 → readHistory / checkProgress 两条 status 按序发出（emitStartup 闸门保持）', async () => {
    const repo = new MemoryTripPlanRepo()
    const { plan, token } = await heldRun(repo)
    const events: PlanAgentEvent[] = []

    await runPrelude(repo, plan.id, { runToken: token, userMessagePersisted: true, events })

    const statuses = events.filter((e) => e.type === 'status') as Extract<PlanAgentEvent, { type: 'status' }>[]
    expect(statuses.map((s) => s.phase)).toEqual([
      startupStatusPhrase('readHistory', 'zh'),
      startupStatusPhrase('checkProgress', 'zh'),
    ])
  })

  it('userMessagePersisted=false → 单读之后照常追加本轮 human 消息（stageHistory = 历史 + 本条）', async () => {
    const repo = new MemoryTripPlanRepo()
    const { plan } = await heldRun(repo)
    // 先模拟一段已有历史
    await repo.appendMessage(plan.id, 'assistant', { role: 'assistant', content: '旧答' })

    const result = await runPrelude(repo, plan.id, { userMessagePersisted: false })

    expect(result.stageHistory.map((m) => m.kind)).toEqual(['human', 'assistant', 'human'])
    expect(await repo.listMessages(plan.id)).toHaveLength(3)
  })
})
