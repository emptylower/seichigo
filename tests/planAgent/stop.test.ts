import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { createLeaseWatcher, isUserStoppedAbort, RUN_STOP_MARKER, userStoppedAbort } from '@/lib/planAgent/stop'

/** A3：停止语义——租约看守、repo 停止方法与跨隔离体可见的停止标记 */

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

describe('createLeaseWatcher', () => {
  it('L7：默认轮询间隔 3000ms——2 秒时未触发、3 秒到点触发', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const onStopped = vi.fn(() => controller.abort(userStoppedAbort()))
      let stopped = false
      const watcher = createLeaseWatcher({ check: async () => stopped, onStopped })
      watcher.start(controller)
      // 2 秒：未到默认间隔（旧值 2000 会在这一步就触发）
      await vi.advanceTimersByTimeAsync(2_000)
      expect(onStopped).not.toHaveBeenCalled()
      stopped = true
      await vi.advanceTimersByTimeAsync(1_100)
      expect(onStopped).toHaveBeenCalledTimes(1)
      expect(isUserStoppedAbort(controller.signal.reason)).toBe(true)
      watcher.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('check 为真时在 interval 内触发 onStopped，abort reason 是 user_stopped', async () => {
    const controller = new AbortController()
    const onStopped = vi.fn(() => controller.abort(userStoppedAbort()))
    const watcher = createLeaseWatcher({ check: async () => true, intervalMs: 2_000, onStopped })
    watcher.start(controller)
    await vi.waitFor(() => expect(onStopped).toHaveBeenCalledTimes(1), { timeout: 500 })
    expect(controller.signal.aborted).toBe(true)
    expect(isUserStoppedAbort(controller.signal.reason)).toBe(true)
    watcher.stop()
  })

  it('check 为假时不触发；stop() 后不再触发（后续 check 翻真也不 abort）', async () => {
    const controller = new AbortController()
    const onStopped = vi.fn()
    let stopped = false
    const watcher = createLeaseWatcher({
      check: async () => stopped,
      intervalMs: 20,
      onStopped,
    })
    watcher.start(controller)
    await new Promise((r) => setTimeout(r, 60))
    expect(onStopped).not.toHaveBeenCalled()
    watcher.stop()
    stopped = true
    await new Promise((r) => setTimeout(r, 80))
    expect(onStopped).not.toHaveBeenCalled()
    expect(controller.signal.aborted).toBe(false)
  })

  it('check 抛错按"未停止"处理，不打断轮询', async () => {
    const controller = new AbortController()
    const onStopped = vi.fn()
    let calls = 0
    const watcher = createLeaseWatcher({
      check: async () => {
        calls += 1
        if (calls === 1) throw new Error('db down')
        return true
      },
      intervalMs: 20,
      onStopped,
    })
    watcher.start(controller)
    await vi.waitFor(() => expect(onStopped).toHaveBeenCalledTimes(1), { timeout: 500 })
    watcher.stop()
  })
})

describe('repo 停止方法（MemoryTripPlanRepo）', () => {
  it('stopAgentRun：清 busy/token、写实况停止标记；再次停止返回 false', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginRun(repo, plan.id)

    expect(await repo.isAgentRunStopped(plan.id, begin.token)).toBe(false)
    expect(await repo.stopAgentRun(plan.id)).toBe(true)

    expect(await repo.isAgentBusy(plan.id)).toBe(false)
    expect(await repo.isAgentRunStopped(plan.id, begin.token)).toBe(true)
    const row = await repo.getRunLive(plan.id)
    expect(row?.runToken).toBe(begin.token)
    expect(row?.statusText).toBe(RUN_STOP_MARKER)
    // 无 run 可停（token 已清）
    expect(await repo.stopAgentRun(plan.id)).toBe(false)
  })

  it('H2：stopAgentRun 清 token 的同时写一条持久 stopped 日志（turnIndex 接在最后一条日志之后）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginRun(repo, plan.id)
    // 已有一条 turnIndex=2 的历史日志
    await repo.appendRunLog({ planId: plan.id, runToken: 'run-old', turnIndex: 2, stage: 'works', durationMs: 100 })

    expect(await repo.stopAgentRun(plan.id)).toBe(true)

    const logs = await repo.listRunLogs(plan.id)
    const stoppedLogs = logs.filter((l) => l.stage === 'stopped')
    expect(stoppedLogs).toHaveLength(1)
    expect(stoppedLogs[0]!.runToken).toBe(begin.token)
    expect(stoppedLogs[0]!.turnIndex).toBe(3)
    expect(stoppedLogs[0]!.durationMs).toBe(0)
  })

  it('停止标记对同 run 的后续实况 flush 是粘性的；新 run 接管时重置', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginRun(repo, plan.id)

    await repo.stopAgentRun(plan.id)
    // 运行中 writer 的 reasoning flush 不会把标记冲掉
    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningAppend: '思考中……', statusText: '正在搜索作品' })
    let row = await repo.getRunLive(plan.id)
    expect(row?.statusText).toBe(RUN_STOP_MARKER)
    expect(row?.reasoning).toContain('思考中')

    // 新 run 接管：标记随行重置消失
    const takeover = await beginRun(repo, plan.id)
    await repo.upsertRunLive(plan.id, { runToken: takeover.token, reasoningReplace: '新 run 思考', statusText: '正在规划' })
    row = await repo.getRunLive(plan.id)
    expect(row?.statusText).toBe('正在规划')
    expect(row?.reasoning).toBe('新 run 思考')
  })
})
