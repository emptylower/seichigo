import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

/**
 * Task A4（§0.6）：GET /api/me/plans/:id/agent/stream 只读观察流——鉴权、
 * 快照 diff 推送（live/chat/plan_updated）、busy 收幕（chat+done）、abort
 * 停读、seq 单调。
 */

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(),
}))

import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { GET } from '@/app/api/me/plans/[id]/agent/stream/route'

function makeDeps(repo: MemoryTripPlanRepo, userId = 'u1'): TripPlanHandlerDeps {
  return { repo, getSession: vi.fn().mockResolvedValue({ user: { id: userId } }) }
}

function streamRequest(planId: string, signal?: AbortSignal) {
  return GET(
    new Request(`http://localhost/api/me/plans/${planId}/agent/stream`, { signal }),
    { params: Promise.resolve({ id: planId }) },
  )
}

type SseEvent = { type: string; seq: number } & Record<string, unknown>

function createPump(res: Response) {
  const events: SseEvent[] = []
  const decoder = new TextDecoder()
  const pump = (async () => {
    const reader = res.body!.getReader()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx = buffer.indexOf('\n\n')
      while (idx >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as SseEvent)
        }
        idx = buffer.indexOf('\n\n')
      }
    }
  })()
  return { events, pump }
}

async function beginBusy(repo: MemoryTripPlanRepo, planId: string) {
  const begin = await repo.beginAgentRun({
    planId,
    userId: 'u1',
    content: { role: 'user', content: '帮我排一天' },
    since: new Date(0),
    limit: 10,
    busyTtlMs: 60_000,
  })
  if (begin.status !== 'ok') throw new Error('unreachable')
  return begin
}

describe('观察流 GET /api/me/plans/:id/agent/stream（Task A4）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('未登录 → 401；非本人 → 404', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue({
      repo,
      getSession: vi.fn().mockResolvedValue(null),
    })

    const res = await streamRequest(plan.id)
    expect(res.status).toBe(401)

    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo, 'u2'))
    const forbidden = await streamRequest(plan.id)
    expect(forbidden.status).toBe(404)
  })

  it('响应头与首帧 ready(seq 0)', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await beginBusy(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(100)
    expect(events[0]).toEqual({ type: 'ready', seq: 0 })
    // 收尾避免悬挂：释放 busy 后推进一轮轮询间隔，让 done 到达、流关闭
    await repo.endAgentRun(plan.id, (await repo.getPlan(plan.id))!.agentRunToken ?? '')
    await vi.advanceTimersByTimeAsync(500)
    await pump
  })

  it('快照无变化不推事件；实况行更新 → live；追加消息 → chat；endAgentRun → chat + done', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    const { events, pump } = createPump(res)

    // 基线 + 两次空轮询：只有 ready
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(500)
    expect(events).toEqual([{ type: 'ready', seq: 0 }])

    // 实况行落库 → 下一轮推送 live
    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningReplace: '正在思考' })
    await vi.advanceTimersByTimeAsync(500)
    const live = events.find((e) => e.type === 'live')!
    expect(live).toBeDefined()
    expect(live.reasoning).toBe('正在思考')
    expect(typeof live.updatedAt).toBe('string')

    // 追加 assistant 消息 → chat 全量
    await repo.appendMessageIfActive(plan.id, begin.token, 'assistant', {
      role: 'assistant',
      content: '安排好了。',
    })
    await vi.advanceTimersByTimeAsync(500)
    const chat = events.find((e) => e.type === 'chat')!
    expect(chat).toBeDefined()
    expect(chat.chat).toHaveLength(2)
    expect(chat.chatRevision).toBeGreaterThan(0)

    // 写正常运行日志后结束 run → done（interrupted=null）
    await repo.appendRunLog({
      planId: plan.id,
      runToken: begin.token,
      turnIndex: 1,
      stage: 'deliver',
      durationMs: 100,
    })
    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    const done = events.filter((e) => e.type === 'done').at(-1)!
    expect(done).toBeDefined()
    expect(done.interrupted).toBeNull()
    await pump

    // seq 单调递增（ready=0 起）
    const seqs = events.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('renewAgentRun 不推 plan_updated；标题真正变化才推一次', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'plan_updated')).toHaveLength(0)

    // 续租只写 agentBusyUntil（Prisma 会顺带刷 updatedAt）——不推
    await repo.renewAgentRun(plan.id, begin.token, 60_000)
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'plan_updated')).toHaveLength(0)

    await repo.updateMeta(plan.id, { title: '新标题' })
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'plan_updated')).toHaveLength(1)

    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    await pump
  })

  it('追加 tool 消息不推 chat；追加 assistant 消息只推一次（busy 落幕不重复推）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'chat')).toHaveLength(0)

    // tool 消息动了 chatRevision 但不进可见视图——不推
    await repo.appendMessageIfActive(plan.id, begin.token, 'tool', {
      role: 'tool',
      tool_call_id: 'call-1',
      content: '{"ok":true}',
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'chat')).toHaveLength(0)

    // assistant 消息进可见视图——推一次全量
    await repo.appendMessageIfActive(plan.id, begin.token, 'assistant', {
      role: 'assistant',
      content: '安排好了。',
    })
    await vi.advanceTimersByTimeAsync(500)
    const chats = events.filter((e) => e.type === 'chat')
    expect(chats).toHaveLength(1)
    expect((chats[0] as unknown as { chat: unknown[] }).chat).toHaveLength(2)

    // busy 落幕：可见对话无变化 → 不重复推 chat，但 done 照发
    await repo.appendRunLog({
      planId: plan.id,
      runToken: begin.token,
      turnIndex: 1,
      stage: 'deliver',
      durationMs: 100,
    })
    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'chat')).toHaveLength(1)
    const done = events.filter((e) => e.type === 'done').at(-1)!
    expect(done).toMatchObject({ reason: 'finished', stopped: false })
    await pump
  })

  it('run 被打断（无运行日志）→ done.interrupted 携带推断信息', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(500)

    // 硬杀形态：busy 释放但没有任何运行日志
    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    const done = events.filter((e) => e.type === 'done').at(-1)!
    expect(done.interrupted).toMatchObject({ reason: 'missing_run_log', turnIndex: 1 })
    await pump
  })

  it('客户端 abort 后不再读快照', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await beginBusy(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const snapshotSpy = vi.spyOn(repo, 'getRunSnapshotMeta')

    const controller = new AbortController()
    const res = await streamRequest(plan.id, controller.signal)
    const { pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(500)
    const readsBefore = snapshotSpy.mock.calls.length
    expect(readsBefore).toBeGreaterThan(0)

    controller.abort()
    await vi.advanceTimersByTimeAsync(1500)
    expect(snapshotSpy.mock.calls.length).toBe(readsBefore)
    await pump
  })

  it('正常结束（最新日志非 stopped）→ done.reason=finished、stopped=false', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(500)

    await repo.appendRunLog({
      planId: plan.id,
      runToken: begin.token,
      turnIndex: 1,
      stage: 'deliver',
      durationMs: 100,
    })
    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)

    const done = events.filter((e) => e.type === 'done').at(-1)!
    expect(done).toMatchObject({ reason: 'finished', stopped: false, interrupted: null })
    await pump
  })

  it('stopAgentRun 后结束（最新日志 stage=stopped）→ done.reason=finished、stopped=true', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    await beginBusy(repo, plan.id)
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(500)

    await repo.stopAgentRun(plan.id)
    await vi.advanceTimersByTimeAsync(500)

    const done = events.filter((e) => e.type === 'done').at(-1)!
    expect(done).toMatchObject({ reason: 'finished', stopped: true, interrupted: null })
    await pump
  })

  it('连接达到 15 min 上限且 run 仍在跑 → done.reason=rotate、stopped=false、interrupted=null', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    // busy 租约要盖过 15 min，否则轮换前就"结束"了
    const begin = await repo.beginAgentRun({
      planId: plan.id,
      userId: 'u1',
      content: { role: 'user', content: '帮我排一天' },
      since: new Date(0),
      limit: 10,
      busyTtlMs: 20 * 60_000,
    })
    if (begin.status !== 'ok') throw new Error('unreachable')
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(15 * 60_000)

    const done = events.filter((e) => e.type === 'done').at(-1)!
    expect(done).toMatchObject({ reason: 'rotate', stopped: false, interrupted: null })
    await repo.endAgentRun(plan.id, begin.token)
    await pump
  })
})
