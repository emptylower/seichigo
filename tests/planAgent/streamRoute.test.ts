import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

/**
 * 2026-09-10 首帧优化（任务一/任务三）：观察流 after=0 首帧推送、await=1
 * 宽限等待（期间不推 chat/live、心跳注释行、超时 not_started）、不带新参数
 * 时行为回归。
 */

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(),
}))

import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { GET } from '@/app/api/me/plans/[id]/agent/stream/route'

function makeDeps(repo: MemoryTripPlanRepo, userId = 'u1'): TripPlanHandlerDeps {
  return { repo, getSession: vi.fn().mockResolvedValue({ user: { id: userId } }) }
}

function streamRequest(planId: string, query = '') {
  return GET(
    new Request(`http://localhost/api/me/plans/${planId}/agent/stream${query}`, { signal: new AbortController().signal }),
    { params: Promise.resolve({ id: planId }) },
  )
}

type SseEvent = { type: string; seq: number } & Record<string, unknown>

/** 同时收集 data: 事件与原始帧（宽限期心跳是 `: ping` 注释行，不是 data: 帧） */
function createPump(res: Response) {
  const events: SseEvent[] = []
  const rawFrames: string[] = []
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
        rawFrames.push(frame)
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as SseEvent)
        }
        idx = buffer.indexOf('\n\n')
      }
    }
  })()
  return { events, rawFrames, pump }
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

describe('观察流首帧与宽限（2026-09-10 首帧优化）', () => {
  beforeEach(() => {
    vi.mocked(getTripPlanApiDeps).mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('任务一：after=0 全新打开——首个快照把当前 live 与 chat 当首帧推出（不静默吞掉）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningReplace: '正在思考', statusText: '正在组织思路' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id, '?after=0')
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(100)

    // 首帧顺序：ready → live → chat（客户端此刻手上没有任何快照）
    expect(events.map((e) => e.type)).toEqual(['ready', 'live', 'chat'])
    const live = events[1]!
    expect(live.reasoning).toBe('正在思考')
    expect(live.statusText).toBe('正在组织思路')
    const chat = events[2]!
    // beginBusy 落库的 human 消息就是首帧 chat 的最后一条
    expect((chat.chat as Array<{ role: string; text: string }>).at(-1)).toMatchObject({
      role: 'user',
      text: '帮我排一天',
    })
    expect(chat.chatRevision).toBeGreaterThan(0)

    // 首帧之后照常差异推送：live 更新 → 再推一帧
    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningAppend: '，继续想' })
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'live')).toHaveLength(2)

    await repo.appendRunLog({ planId: plan.id, runToken: begin.token, turnIndex: 1, stage: 'deliver', durationMs: 100 })
    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'done').at(-1)).toMatchObject({ reason: 'finished', stopped: false })
    await pump
  })

  it('任务一回归：after>0 重连——保持静默基线，首帧只有 ready', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningReplace: '正在思考' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id, '?after=5')
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(500)
    // 重连客户端已从上一条连接拿到 live/chat——基线静默，不重复推
    expect(events).toEqual([{ type: 'ready', seq: 0 }])

    // 快照变化后照常差异推送
    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningAppend: '更多' })
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'live')).toHaveLength(1)

    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    await pump
  })

  it('任务三回归：不带 await=1（也不带 after）——行为与旧版逐字一致', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningReplace: '正在思考' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id)
    const { events, rawFrames, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(1000)
    // 旧客户端：busy=true 时不收幕、不推首帧、没有心跳注释行
    expect(events).toEqual([{ type: 'ready', seq: 0 }])
    expect(rawFrames).toEqual(['data: {"type":"ready","seq":0}'])

    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
    await pump
  })

  it('任务三：await=1 且未 busy → 宽限等待，期间不读 chat、不推 live/chat，只发心跳注释行', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const listMessages = vi.spyOn(repo, 'listMessages')

    const res = await streamRequest(plan.id, '?after=0&await=1')
    const { events, rawFrames, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(600)
    // 宽限期内只有 ready；绝不读 chat（推 chat 会把客户端乐观追加的用户气泡抹掉）
    expect(events).toEqual([{ type: 'ready', seq: 0 }])
    expect(listMessages).not.toHaveBeenCalled()
    expect(rawFrames).toEqual(['data: {"type":"ready","seq":0}'])

    // busy 变 true（POST 已落 human 消息 + 实况行已有首条 status）→ 正式开始，
    // 按 after=0 规则把 live + chat 作为首帧推出
    const begin = await beginBusy(repo, plan.id)
    await repo.upsertRunLive(plan.id, { runToken: begin.token, statusText: '正在读取对话历史' })
    await vi.advanceTimersByTimeAsync(200)
    expect(events.map((e) => e.type)).toEqual(['ready', 'live', 'chat'])
    expect((events.find((e) => e.type === 'live') as unknown as { statusText: string }).statusText).toBe(
      '正在读取对话历史',
    )
    expect(listMessages).toHaveBeenCalled()

    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    expect(events.filter((e) => e.type === 'done').at(-1)).toMatchObject({ reason: 'finished' })
    await pump
  })

  it('任务三：宽限期每 5 秒发一次 `: ping` 心跳注释行（客户端 sseFrames 只取 data: 行）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id, '?after=0&await=1')
    const { events, rawFrames, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(4_900)
    expect(rawFrames.filter((f) => f === ': ping')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(rawFrames.filter((f) => f === ': ping')).toHaveLength(1)
    // 心跳不是 data: 帧——事件流不受污染
    expect(events).toEqual([{ type: 'ready', seq: 0 }])

    // 释放收尾：让宽限走完并关流
    await vi.advanceTimersByTimeAsync(10_000)
    await pump
  })

  it('任务三：宽限 10 秒超时仍未 busy → done{ reason:"not_started" } 并关闭', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))
    const listMessages = vi.spyOn(repo, 'listMessages')

    const res = await streamRequest(plan.id, '?after=0&await=1')
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(10_000)

    const done = events.filter((e) => e.type === 'done').at(-1)!
    expect(done).toMatchObject({ reason: 'not_started', stopped: false, interrupted: null })
    // 整个宽限期没推过 chat/live
    expect(events.filter((e) => e.type === 'chat' || e.type === 'live')).toHaveLength(0)
    expect(listMessages).not.toHaveBeenCalled()
    await pump
  })

  it('任务三：await=1 但首个快照已 busy → 不进宽限，直接按 after 规则开始', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const begin = await beginBusy(repo, plan.id)
    await repo.upsertRunLive(plan.id, { runToken: begin.token, reasoningReplace: '已在跑' })
    vi.mocked(getTripPlanApiDeps).mockResolvedValue(makeDeps(repo))

    const res = await streamRequest(plan.id, '?after=0&await=1')
    const { events, pump } = createPump(res)
    await vi.advanceTimersByTimeAsync(100)
    expect(events.map((e) => e.type)).toEqual(['ready', 'live', 'chat'])

    await repo.endAgentRun(plan.id, begin.token)
    await vi.advanceTimersByTimeAsync(500)
    await pump
  })
})
