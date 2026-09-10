import { describe, expect, it } from 'vitest'
import { runPlanAgent, type CreateMessageFn, type PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { createRunCostTracker } from '@/lib/planAgent/runCost'
import { createRunTimingCollector, queueLatencyMsOf } from '@/lib/planAgent/runTimings'
import { createEnrichBudget } from '@/lib/planAgent/enrich/types'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import type { PointFinder } from '@/lib/planAgent/points'

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

const T0 = 1_800_000_000_000
const iso = (ms: number): string => new Date(ms).toISOString()

describe('runTimings 收集器（假时钟）', () => {
  it('完整队列路径：各分段差值与 ISO 时刻都用假时钟算得正确', () => {
    let clock = T0
    const collector = createRunTimingCollector(
      { enqueuedAt: iso(T0 - 15_000), consumerEnteredAt: iso(T0) },
      () => clock,
    )
    // loop 未启动前快照整体省略（不写半截数据）
    expect(collector.snapshot()).toBeUndefined()
    clock += 40
    collector.markLoopStarted()
    clock += 110
    collector.markStatus()
    clock += 250
    collector.markModelByte()
    clock += 5_000
    // 重复标记不覆盖首条
    collector.markStatus()
    collector.markModelByte()

    const t = collector.snapshot()
    expect(t).toBeDefined()
    expect(t?.enqueuedAt).toBe(iso(T0 - 15_000))
    expect(t?.consumerEnteredAt).toBe(iso(T0))
    expect(t?.loopStartedAt).toBe(iso(T0 + 40))
    expect(t?.firstStatusAt).toBe(iso(T0 + 150))
    expect(t?.firstModelByteAt).toBe(iso(T0 + 400))
    expect(t?.queueLatencyMs).toBe(15_000)
    expect(t?.loopStartMs).toBe(40)
    expect(t?.toFirstStatusMs).toBe(150)
    expect(t?.toFirstModelByteMs).toBe(400)
  })

  it('SSE 内联路径（无 enqueuedAt）不炸且省略 queueLatencyMs/enqueuedAt', () => {
    const collector = createRunTimingCollector({ consumerEnteredAt: iso(T0) }, () => T0)
    collector.markLoopStarted()
    collector.markStatus()
    collector.markModelByte()
    const t = collector.snapshot()
    expect(t).toBeDefined()
    expect('enqueuedAt' in (t ?? {})).toBe(false)
    expect('queueLatencyMs' in (t ?? {})).toBe(false)
    // 同刻标记时差值为 0（真实测得的 0，不是省略语义的占位 0）
    expect(t?.loopStartMs).toBe(0)
    expect(t?.toFirstStatusMs).toBe(0)
    expect(t?.toFirstModelByteMs).toBe(0)
  })

  it('enqueuedAt 不可解析时省略 queueLatencyMs 而非写 NaN', () => {
    expect(queueLatencyMsOf(undefined, T0)).toBeUndefined()
    expect(queueLatencyMsOf('not-a-date', T0)).toBeUndefined()
    expect(queueLatencyMsOf(iso(T0 - 250), T0)).toBe(250)
    const collector = createRunTimingCollector({ enqueuedAt: 'not-a-date', consumerEnteredAt: iso(T0) }, () => T0)
    collector.markLoopStarted()
    const t = collector.snapshot()
    expect(t?.enqueuedAt).toBe('not-a-date')
    expect('queueLatencyMs' in (t ?? {})).toBe(false)
  })

  it('consumerEnteredAt 不可解析时快照整体省略', () => {
    const collector = createRunTimingCollector({ consumerEnteredAt: 'bad' }, () => T0)
    collector.markLoopStarted()
    expect(collector.snapshot()).toBeUndefined()
  })
})

describe('runCost 与 timings 集成', () => {
  it('getTimings 注入时 summary 带 timings 键；不注入时键不存在（既有字段语义不变）', () => {
    const collector = createRunTimingCollector({ consumerEnteredAt: iso(T0) }, () => T0)
    collector.markLoopStarted()
    const base = { enrichBudget: createEnrichBudget(), maxIterations: 5, withTitle: true, now: () => T0 }

    const injected = createRunCostTracker({ ...base, getTimings: collector.snapshot }).summary() as Record<string, unknown>
    expect(injected.timings).toMatchObject({ consumerEnteredAt: iso(T0), loopStartedAt: iso(T0), loopStartMs: 0 })
    // 既有字段照常存在（timings 只是新增顶层键）
    expect(injected.tokens).toBeDefined()
    expect(injected.modelCalls).toBe(0)
    expect(injected.usageMissing).toBe(true)

    const plain = createRunCostTracker(base).summary() as Record<string, unknown>
    expect('timings' in plain).toBe(false)
    expect(plain.modelCalls).toBe(0)
    expect(plain.usageMissing).toBe(true)
  })
})

describe('runPlanAgent 埋点（loop 级）', () => {
  it('firstStatusAt 覆盖 startupStatus 发出的首条 status（模型不发 status 也能记到）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    let clock = T0
    // 模型不 emit 任何 status：唯一的首条 status 只能来自 startupStatus 发送器
    const createMessage: CreateMessageFn = async () =>
      ({ role: 'assistant', content: '好的', refusal: null }) as PlanAgentChatMessage
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        maxIterations: 5,
        // SSE 内联路径：无 enqueuedAt
        timingSeed: { consumerEnteredAt: iso(T0 - 60) },
        now: () => clock,
      },
      '你好',
      () => {},
    )
    const [log] = await repo.listRunLogs(plan.id)
    const timings = (log.modelUsage as Record<string, any>).timings
    expect(timings).toBeDefined()
    expect(timings.loopStartMs).toBe(60)
    expect(timings.firstStatusAt).toBe(iso(T0))
    expect(timings.toFirstStatusMs).toBe(60)
    // 不经队列：两个字段都必须省略
    expect('enqueuedAt' in timings).toBe(false)
    expect('queueLatencyMs' in timings).toBe(false)
  })

  it('队列路径：queueLatencyMs 与首个模型 delta 的 firstModelByteAt 落进 modelUsage.timings', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    let clock = T0
    const createMessage: CreateMessageFn = async (_params, onDelta) => {
      clock = T0 + 300
      onDelta?.({ content: '好' })
      return { role: 'assistant', content: '好的', refusal: null } as PlanAgentChatMessage
    }
    await runPlanAgent(
      {
        createMessage,
        repo,
        planId: plan.id,
        toolDeps: { planId: plan.id, repo, points: finder },
        maxIterations: 5,
        timingSeed: { enqueuedAt: iso(T0 - 15_000), consumerEnteredAt: iso(T0) },
        now: () => clock,
      },
      '你好',
      () => {},
    )
    const [log] = await repo.listRunLogs(plan.id)
    const timings = (log.modelUsage as Record<string, any>).timings
    expect(timings.enqueuedAt).toBe(iso(T0 - 15_000))
    expect(timings.queueLatencyMs).toBe(15_000)
    expect(timings.firstModelByteAt).toBe(iso(T0 + 300))
    expect(timings.toFirstModelByteMs).toBe(300)
  })

  it('不传 timingSeed（旧调用路径）时 modelUsage 不出现 timings 键', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const createMessage: CreateMessageFn = async () =>
      ({ role: 'assistant', content: '好的', refusal: null }) as PlanAgentChatMessage
    await runPlanAgent(
      { createMessage, repo, planId: plan.id, toolDeps: { planId: plan.id, repo, points: finder }, maxIterations: 5 },
      '你好',
      () => {},
    )
    const [log] = await repo.listRunLogs(plan.id)
    expect('timings' in (log.modelUsage as Record<string, unknown>)).toBe(false)
  })
})
