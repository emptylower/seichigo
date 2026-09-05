import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { createRunLiveWriter } from '@/lib/planAgent/runLive'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import type { TripPlanRunLivePatch } from '@/lib/tripPlan/repo'

/** 第七轮 A1：运行实况 writer 的节流 / 收尾 / 容错 */

function reasoning(delta: string): PlanAgentEvent {
  return { type: 'reasoning', delta }
}

async function makePlan() {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  return { repo, planId: plan.id }
}

/** 等所有在途 microtask/chain 步落定（memory repo 的 async upsert 有多拍 hop） */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createRunLiveWriter（节流与收尾）', () => {
  it('节流：连续 10 个 reasoning 事件（恰好达到字数阈值）只触发 1 次 upsertRunLive', async () => {
    const { repo, planId } = await makePlan()
    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const writer = createRunLiveWriter({
      repo,
      planId,
      runToken: 'run-1',
      flushIntervalMs: 60_000, // 时间阈值放宽，只考察字数节流
      flushChars: 400,
    })
    for (let i = 0; i < 10; i++) writer.onEvent(reasoning('x'.repeat(40)))
    await writer.finish()
    // 10×40=400：第 10 个事件触发唯一一次节流 flush；finish 时缓冲已干净不再补写
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0]![1].reasoningReplace).toBe('x'.repeat(400))
  })

  it('未达阈值的事件不写库；finish 强制 flush 完整实况并 clearRunLive', async () => {
    const { repo, planId } = await makePlan()
    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const clear = vi.spyOn(repo, 'clearRunLive')
    const writer = createRunLiveWriter({
      repo,
      planId,
      runToken: 'run-1',
      flushIntervalMs: 60_000,
      flushChars: 400,
    })
    writer.onEvent(reasoning('思考'))
    writer.onEvent(reasoning('片段'))
    expect(upsert).not.toHaveBeenCalled()

    await writer.finish()
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0]![1]).toMatchObject({ runToken: 'run-1', reasoningReplace: '思考片段' })
    expect(clear).toHaveBeenCalledWith(planId)
    expect(await repo.getRunLive(planId)).toBeNull()
  })

  it('status 事件写 statusText；tool_call 事件维护工具列表的 running→done 状态', async () => {
    const { repo, planId } = await makePlan()
    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const writer = createRunLiveWriter({ repo, planId, runToken: 'run-1', flushIntervalMs: 60_000, flushChars: 100_000 })
    writer.onEvent({ type: 'status', phase: '正在搜索作品' })
    writer.onEvent({
      type: 'tool_call',
      id: 'c1',
      name: 'search_bangumi_tv',
      argsSummary: '京吹',
      status: 'running',
    })
    writer.onEvent({
      type: 'tool_call',
      id: 'c1',
      name: 'search_bangumi_tv',
      argsSummary: '京吹',
      status: 'done',
      durationMs: 120,
      resultSummary: '找到 3 部作品',
    })
    await writer.finish()
    const patch: TripPlanRunLivePatch = upsert.mock.calls.at(-1)![1]
    expect(patch.statusText).toBe('正在搜索作品')
    expect(patch.toolCalls).toEqual([{ name: 'search_bangumi_tv', status: 'done', summary: '找到 3 部作品' }])
  })

  it('时间阈值到达时也会触发 flush（慢速 reasoning 流也能定期刷新实况）', async () => {
    const { repo, planId } = await makePlan()
    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const writer = createRunLiveWriter({
      repo,
      planId,
      runToken: 'run-1',
      flushIntervalMs: 0, // 任一事件都视为距上次 flush 超时
      flushChars: 1_000_000,
    })
    writer.onEvent(reasoning('a'))
    await settle() // flush#1 落定
    writer.onEvent(reasoning('b'))
    await settle() // flush#2 落定
    await writer.finish()
    expect(upsert).toHaveBeenCalledTimes(2)
    // 第九轮 A3：首刷 replace 建行，之后只发增量 append；两拍拼出全文
    expect(upsert.mock.calls[0]![1].reasoningReplace).toBe('a')
    expect(upsert.mock.calls[1]![1].reasoningAppend).toBe('b')
  })

  it('第九轮 A3：连续 3 次 flush → 首刷 replace + 两次 append 的长度之和等于总长度，落库即全文', async () => {
    const { repo, planId } = await makePlan()
    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const writer = createRunLiveWriter({
      repo,
      planId,
      runToken: 'run-1',
      flushIntervalMs: 60_000, // 只考察字数阈值
      flushChars: 100,
    })
    const chunk = (label: string) => label.repeat(100)
    writer.onEvent(reasoning(chunk('一'))) // flush #1：首次 → reasoningReplace
    await settle()
    writer.onEvent(reasoning(chunk('二'))) // flush #2：→ reasoningAppend
    await settle()
    writer.onEvent(reasoning(chunk('三'))) // flush #3：→ reasoningAppend
    await settle()
    // 落库行此刻（finish 会 clear）应为三段全文——追加语义无重复、无丢失
    expect((await repo.getRunLive(planId))?.reasoning).toBe(chunk('一') + chunk('二') + chunk('三'))
    await writer.finish()
    expect(upsert).toHaveBeenCalledTimes(3)
    const [first, second, third] = upsert.mock.calls.map((call) => call[1]!)
    expect(first.reasoningReplace).toBe(chunk('一'))
    expect(first.reasoningAppend).toBeUndefined()
    expect(second.reasoningAppend).toBe(chunk('二'))
    expect(third.reasoningAppend).toBe(chunk('三'))
    const sentLength =
      (first.reasoningReplace?.length ?? 0) +
      (second.reasoningAppend?.length ?? 0) +
      (third.reasoningAppend?.length ?? 0)
    expect(sentLength).toBe(300)
  })

  it('M2：fenced 收尾（flush:false, clear:false）不写库——新 run 的实况行不被旧 token 覆盖', async () => {
    const { repo, planId } = await makePlan()
    await repo.upsertRunLive(planId, { runToken: 'run-new', reasoningReplace: '新 run 的实况' })
    const upsert = vi.spyOn(repo, 'upsertRunLive')
    const clear = vi.spyOn(repo, 'clearRunLive')
    const writer = createRunLiveWriter({ repo, planId, runToken: 'run-stale', flushIntervalMs: 60_000, flushChars: 100_000 })
    writer.onEvent(reasoning('旧 run 残留思考'))
    await writer.finish({ flush: false, clear: false })
    // fenced：未刷新的增量被丢弃，绝不 upsert、绝不 clear
    expect(upsert).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    const row = await repo.getRunLive(planId)
    expect(row?.runToken).toBe('run-new')
    expect(row?.reasoning).toBe('新 run 的实况')
  })

  it('M2：fenced 收尾会取消已排队、尚未执行的 flush（在途 upsert 落定后不补写）', async () => {
    const { repo, planId } = await makePlan()
    const original = repo.upsertRunLive.bind(repo)
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let invocation = 0
    const upsert = vi.spyOn(repo, 'upsertRunLive').mockImplementation(async (pid, patch) => {
      invocation += 1
      if (invocation === 1) await gate
      return original(pid, patch)
    })
    const writer = createRunLiveWriter({ repo, planId, runToken: 'run-1', flushIntervalMs: 60_000, flushChars: 1 })
    writer.onEvent(reasoning('a')) // 触发 flush#1（在 gate 上挂起）
    await new Promise((resolve) => setTimeout(resolve, 0)) // 等 chain 步真正开始执行 flushNow
    writer.onEvent(reasoning('b')) // flush#2 排队在 flush#1 之后
    await writer.finish({ flush: false, clear: false }) // fenced：取消排队的 flush#2
    release()
    await new Promise((resolve) => setTimeout(resolve, 0)) // 等 flush#1 落定、被取消的 flush#2 跳过
    expect(upsert).toHaveBeenCalledTimes(1)
    const row = await repo.getRunLive(planId)
    expect(row?.reasoning).toBe('a') // 只有 flush#1 的快照落库，b 被丢弃
  })

  it('M4：finish({flush:false, clear:true}) 返回排入 clear 的 chain——clear 落定后才 resolve（停止收尾的 2 秒预算才有机会等到它）', async () => {
    const { repo, planId } = await makePlan()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const clear = vi.spyOn(repo, 'clearRunLive').mockImplementation(async () => {
      await gate
    })
    const writer = createRunLiveWriter({ repo, planId, runToken: 'run-1', flushIntervalMs: 60_000, flushChars: 100_000 })
    let settled = false
    const finishing = writer.finish({ flush: false, clear: true }).then(() => {
      settled = true
    })
    // clear 仍挂起：finish 不得提前 resolve（否则 loop 的 Promise.race 等不到它）
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    release()
    await finishing
    expect(settled).toBe(true)
    expect(clear).toHaveBeenCalledWith(planId)
  })

  it('写库失败只 warn 不抛出：upsertRunLive reject 时 finish 仍正常完成并 clear', async () => {
    const { repo, planId } = await makePlan()
    vi.spyOn(repo, 'upsertRunLive').mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const writer = createRunLiveWriter({ repo, planId, runToken: 'run-1', flushIntervalMs: 60_000, flushChars: 100_000 })
      writer.onEvent(reasoning('x'))
      await expect(writer.finish()).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
