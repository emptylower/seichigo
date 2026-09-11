import { describe, expect, it } from 'vitest'
import { runPlanAgent, type CreateMessageFn, type PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { createRunCostTracker } from '@/lib/planAgent/runCost'
import {
  createRunTimingCollector,
  parseConsumerBatchStamp,
  parseDispatchSegmentStamp,
  queueLatencyMsOf,
} from '@/lib/planAgent/runTimings'
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

describe('队列段拆分（C 部分：消费者戳）', () => {
  const SPLIT_KEYS = ['consumerBatchAt', 'consumerSeq', 'queueDispatchMs', 'selfRefHopMs'] as const

  it('两个头都在：queueDispatchMs / selfRefHopMs / consumerSeq 正确，且两段之和 === queueLatencyMs', () => {
    let clock = T0
    const collector = createRunTimingCollector(
      {
        enqueuedAt: iso(T0 - 15_000),
        consumerBatchAt: iso(T0 - 8_000),
        consumerSeq: 1,
        consumerEnteredAt: iso(T0),
      },
      () => clock,
    )
    collector.markLoopStarted()
    collector.markStatus()
    collector.markModelRequestSent()
    clock += 3_600
    collector.markModelByte()

    const t = collector.snapshot()
    expect(t).toBeDefined()
    expect(t?.consumerBatchAt).toBe(iso(T0 - 8_000))
    expect(t?.consumerSeq).toBe(1)
    expect(t?.queueDispatchMs).toBe(7_000)
    expect(t?.selfRefHopMs).toBe(8_000)
    // 拆分守恒：纯派发 + 服务绑定跳 === 既有混合段（历史数据可比）
    expect((t?.queueDispatchMs ?? NaN) + (t?.selfRefHopMs ?? NaN)).toBe(t?.queueLatencyMs)
    expect(t?.queueLatencyMs).toBe(15_000)
  })

  it('旧版消费者的在途消息（有 enqueuedAt、无消费者戳）：四个字段整体省略，不写 0/NaN', () => {
    const collector = createRunTimingCollector(
      { enqueuedAt: iso(T0 - 15_000), consumerEnteredAt: iso(T0) },
      () => T0,
    )
    collector.markLoopStarted()
    const t = collector.snapshot()
    expect(t).toBeDefined()
    for (const key of SPLIT_KEYS) expect(key in (t ?? {})).toBe(false)
    // 既有混合段保留不动
    expect(t?.queueLatencyMs).toBe(15_000)
  })

  it('SSE 内联路径（无 enqueuedAt、无消费者戳）：四个字段同样整体省略', () => {
    const collector = createRunTimingCollector({ consumerEnteredAt: iso(T0) }, () => T0)
    collector.markLoopStarted()
    const t = collector.snapshot()
    expect(t).toBeDefined()
    for (const key of SPLIT_KEYS) expect(key in (t ?? {})).toBe(false)
  })

  it('parseConsumerBatchStamp：缺失/空串/垃圾头 → undefined；合法头 → ISO 时刻 + 整数序号', () => {
    expect(parseConsumerBatchStamp(null, null)).toBeUndefined()
    expect(parseConsumerBatchStamp(null, '1')).toBeUndefined()
    expect(parseConsumerBatchStamp(String(T0), null)).toBeUndefined()
    expect(parseConsumerBatchStamp('', '')).toBeUndefined()
    expect(parseConsumerBatchStamp('not-a-number', '1')).toBeUndefined()
    expect(parseConsumerBatchStamp(String(T0), 'abc')).toBeUndefined()
    expect(parseConsumerBatchStamp(String(T0), '1.5')).toBeUndefined()
    const stamp = parseConsumerBatchStamp(String(T0 + 123), '3')
    expect(stamp).toEqual({ consumerBatchMs: T0 + 123, consumerBatchAt: iso(T0 + 123), consumerSeq: 3 })
  })
})

describe('DO 派发段拆分（P2-B：DO 埋点头，Astra 评审后口径）', () => {
  const DO_KEYS = [
    'doIngressMs',
    'doAcceptMs',
    'acceptToAlarmMs',
    'alarmPreludeMs',
    'alarmToEntryMs',
    'moduleId',
    'doInstanceId',
    'isolateAgeMs',
    'alarmAttempt',
  ] as const

  /** 八个头全在的合法输入（doEntered=T0−9500 / acceptedDone=T0−9000 / alarm=T0−3000 / entered=T0） */
  function fullHeaders(overrides: Partial<Record<string, string | null>> = {}) {
    return {
      doEnteredAt: String(T0 - 9_500),
      doAcceptedAt: String(T0 - 9_000),
      alarmAt: String(T0 - 3_000),
      alarmPreludeMs: '5',
      isolateAgeMs: '720',
      alarmAttempt: '1',
      moduleId: 'abcd1234',
      doInstanceId: 'efgh5678',
      ...overrides,
    }
  }

  it('parseDispatchSegmentStamp：必需头缺失/空串/垃圾 → undefined；do-accepted-at 可单独缺省（旧 state）', () => {
    expect(parseDispatchSegmentStamp(fullHeaders({ doEnteredAt: null }))).toBeUndefined()
    expect(parseDispatchSegmentStamp(fullHeaders({ alarmAt: null }))).toBeUndefined()
    expect(parseDispatchSegmentStamp(fullHeaders({ alarmPreludeMs: null }))).toBeUndefined()
    expect(parseDispatchSegmentStamp(fullHeaders({ moduleId: null }))).toBeUndefined()
    expect(parseDispatchSegmentStamp(fullHeaders({ doInstanceId: ' ' }))).toBeUndefined()
    expect(parseDispatchSegmentStamp(fullHeaders({ alarmAttempt: '1.5' }))).toBeUndefined()
    expect(parseDispatchSegmentStamp(fullHeaders({ isolateAgeMs: 'abc' }))).toBeUndefined()
    expect(parseDispatchSegmentStamp(fullHeaders({ alarmAt: 'x' }))).toBeUndefined()
    // 例外：acceptedDoneAt 是滚动部署新字段——仅它缺省时其余照常解析
    expect(parseDispatchSegmentStamp(fullHeaders({ doAcceptedAt: null }))).toEqual({
      doEnteredMs: T0 - 9_500,
      alarmMs: T0 - 3_000,
      alarmPreludeMs: 5,
      isolateAgeMs: 720,
      alarmAttempt: 1,
      moduleId: 'abcd1234',
      doInstanceId: 'efgh5678',
    })
    expect(parseDispatchSegmentStamp(fullHeaders())).toEqual({
      doEnteredMs: T0 - 9_500,
      acceptedDoneMs: T0 - 9_000,
      alarmMs: T0 - 3_000,
      alarmPreludeMs: 5,
      isolateAgeMs: 720,
      alarmAttempt: 1,
      moduleId: 'abcd1234',
      doInstanceId: 'efgh5678',
    })
  })

  it('种子齐全：五段 + 身份字段正确，五段之和 === consumerEntered − dispatched', () => {
    const collector = createRunTimingCollector(
      {
        enqueuedAt: iso(T0 - 12_000),
        consumerBatchAt: iso(T0 - 2_000),
        consumerSeq: 1,
        dispatchedAt: iso(T0 - 10_000),
        doEnteredAt: iso(T0 - 9_500),
        acceptedDoneAt: iso(T0 - 9_000),
        alarmAt: iso(T0 - 3_000),
        alarmPreludeMs: 5,
        isolateAgeMs: 720,
        alarmAttempt: 1,
        moduleId: 'abcd1234',
        doInstanceId: 'efgh5678',
        consumerEnteredAt: iso(T0),
      },
      () => T0,
    )
    collector.markLoopStarted()

    const t = collector.snapshot()
    expect(t).toBeDefined()
    expect(t?.doIngressMs).toBe(500)
    expect(t?.doAcceptMs).toBe(500)
    expect(t?.acceptToAlarmMs).toBe(6_000)
    expect(t?.alarmPreludeMs).toBe(5)
    expect(t?.alarmToEntryMs).toBe(T0 - (T0 - 3_000 + 5))
    expect(t?.moduleId).toBe('abcd1234')
    expect(t?.doInstanceId).toBe('efgh5678')
    expect(t?.isolateAgeMs).toBe(720)
    expect(t?.alarmAttempt).toBe(1)
    // 五段守恒：=== 内部路由入口 − POST 派发（≈ 既有 queueDispatchMs 的口径）
    expect(
      (t?.doIngressMs ?? NaN) +
        (t?.doAcceptMs ?? NaN) +
        (t?.acceptToAlarmMs ?? NaN) +
        (t?.alarmPreludeMs ?? NaN) +
        (t?.alarmToEntryMs ?? NaN),
    ).toBe(10_000)
  })

  it('缺 DO 头（queue 消费者旧路径）：九个字段整体省略，不写 0/NaN', () => {
    const collector = createRunTimingCollector(
      { enqueuedAt: iso(T0 - 15_000), consumerBatchAt: iso(T0 - 8_000), consumerSeq: 2, consumerEnteredAt: iso(T0) },
      () => T0,
    )
    collector.markLoopStarted()
    const t = collector.snapshot()
    expect(t).toBeDefined()
    for (const key of DO_KEYS) expect(key in (t ?? {})).toBe(false)
    // 既有字段不受影响
    expect(t?.queueDispatchMs).toBe(7_000)
  })

  it('acceptedDoneAt 缺省（旧 state 在途）：doAcceptMs/acceptToAlarmMs 省略，其余字段照常', () => {
    const collector = createRunTimingCollector(
      {
        dispatchedAt: iso(T0 - 10_000),
        doEnteredAt: iso(T0 - 9_500),
        alarmAt: iso(T0 - 3_000),
        alarmPreludeMs: 5,
        isolateAgeMs: 720,
        alarmAttempt: 2,
        moduleId: 'abcd1234',
        doInstanceId: 'efgh5678',
        consumerEnteredAt: iso(T0),
      },
      () => T0,
    )
    collector.markLoopStarted()
    const t = collector.snapshot()
    expect(t?.doIngressMs).toBe(500)
    expect(t?.alarmPreludeMs).toBe(5)
    expect(t?.alarmToEntryMs).toBe(2_995)
    expect(t?.isolateAgeMs).toBe(720)
    expect(t?.alarmAttempt).toBe(2)
    expect('doAcceptMs' in (t ?? {})).toBe(false)
    expect('acceptToAlarmMs' in (t ?? {})).toBe(false)
  })

  it('dispatchedAt 缺省：doIngressMs 省略（其余 DO 字段照常）；alarmPreludeMs 缺省时 alarmToEntryMs 省略', () => {
    const noDispatched = createRunTimingCollector(
      {
        doEnteredAt: iso(T0 - 9_500),
        acceptedDoneAt: iso(T0 - 9_000),
        alarmAt: iso(T0 - 3_000),
        alarmPreludeMs: 5,
        isolateAgeMs: 720,
        alarmAttempt: 1,
        moduleId: 'abcd1234',
        doInstanceId: 'efgh5678',
        consumerEnteredAt: iso(T0),
      },
      () => T0,
    )
    noDispatched.markLoopStarted()
    const t1 = noDispatched.snapshot()
    expect('doIngressMs' in (t1 ?? {})).toBe(false)
    expect(t1?.doAcceptMs).toBe(500)
    expect(t1?.acceptToAlarmMs).toBe(6_000)
    expect(t1?.alarmToEntryMs).toBe(2_995)

    const noPrelude = createRunTimingCollector(
      {
        dispatchedAt: iso(T0 - 10_000),
        doEnteredAt: iso(T0 - 9_500),
        acceptedDoneAt: iso(T0 - 9_000),
        alarmAt: iso(T0 - 3_000),
        isolateAgeMs: 720,
        alarmAttempt: 1,
        moduleId: 'abcd1234',
        doInstanceId: 'efgh5678',
        consumerEnteredAt: iso(T0),
      },
      () => T0,
    )
    noPrelude.markLoopStarted()
    const t2 = noPrelude.snapshot()
    expect('alarmPreludeMs' in (t2 ?? {})).toBe(false)
    expect('alarmToEntryMs' in (t2 ?? {})).toBe(false)
    expect(t2?.acceptToAlarmMs).toBe(6_000)
  })
})

describe('「status → 首字节」拆分（C 部分：真实模型 TTFT）', () => {
  it('markModelRequestSent 幂等：不同时刻重复标记只记第一次，realModelTtftMs 用假时钟算得正确', () => {
    let clock = T0
    const collector = createRunTimingCollector({ consumerEnteredAt: iso(T0) }, () => clock)
    collector.markLoopStarted()
    clock += 120
    collector.markModelRequestSent()
    clock += 80
    collector.markModelRequestSent() // 空回合重试/多轮循环再次调用：不覆盖
    clock += 340
    collector.markModelByte()
    collector.markModelByte()

    const t = collector.snapshot()
    expect(t?.modelRequestSentAt).toBe(iso(T0 + 120))
    expect(t?.toModelRequestMs).toBe(120)
    expect(t?.firstModelByteAt).toBe(iso(T0 + 540))
    expect(t?.toFirstModelByteMs).toBe(540)
    expect(t?.realModelTtftMs).toBe(420)
  })

  it('模型请求未发出时省略 modelRequestSentAt / toModelRequestMs / realModelTtftMs', () => {
    const collector = createRunTimingCollector({ consumerEnteredAt: iso(T0) }, () => T0)
    collector.markLoopStarted()
    const t = collector.snapshot()
    expect(t).toBeDefined()
    for (const key of ['modelRequestSentAt', 'toModelRequestMs', 'realModelTtftMs']) {
      expect(key in (t ?? {})).toBe(false)
    }
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

  it('空回合重试让 createMessage 被调两次：modelRequestSentAt 只记第一次，队列段拆分随种子落库', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    let clock = T0 + 40
    let callCount = 0
    // 第一次返回空回合（content: null）触发重试，第二次才给最终答案——
    // 从而在同一 run 内制造两次 createMessage 调用
    const createMessage: CreateMessageFn = async (_params, onDelta) => {
      callCount += 1
      if (callCount === 1) return { role: 'assistant', content: null, refusal: null } as PlanAgentChatMessage
      clock = T0 + 640
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
        timingSeed: {
          enqueuedAt: iso(T0 - 15_000),
          consumerBatchAt: iso(T0 - 8_000),
          consumerSeq: 1,
          consumerEnteredAt: iso(T0),
        },
        now: () => clock,
      },
      '你好',
      () => {},
    )
    expect(callCount).toBe(2)
    const [log] = await repo.listRunLogs(plan.id)
    const timings = (log.modelUsage as Record<string, any>).timings
    // 首次调用前标记于 T0+40；第二次调用（clock 已是 T0+640）不覆盖
    expect(timings.modelRequestSentAt).toBe(iso(T0 + 40))
    expect(timings.toModelRequestMs).toBe(40)
    expect(timings.firstModelByteAt).toBe(iso(T0 + 640))
    expect(timings.realModelTtftMs).toBe(600)
    // 消费者戳四个字段随种子落库，且两段之和等于混合段
    expect(timings.consumerSeq).toBe(1)
    expect(timings.queueDispatchMs).toBe(7_000)
    expect(timings.selfRefHopMs).toBe(8_000)
    expect(timings.queueDispatchMs + timings.selfRefHopMs).toBe(timings.queueLatencyMs)
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
