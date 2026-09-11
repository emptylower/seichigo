/**
 * 2026-09-10 B 部分：启动链路分段埋点的收集器。
 *
 * 生产实测（相对用户点击发送）：POST 202 → 首个 status 落库之间约 15s 只能
 * 靠减法估算（CF Queue 投递 + 消费者 isolate 冷启动 + 内部路由自身开销）。
 * 本文件提供一个可注入假时钟的收集器，把这段拆成实测分段；快照最终写进
 * TripPlanRunLog.modelUsage 的 timings 顶层键（整体可选，不新增数据库列）：
 *
 * - queueLatencyMs = consumerEnteredAt - enqueuedAt（本任务最想要的数）。
 *   SSE 内联路径不经队列、没有 enqueuedAt——省略该字段与 queueLatencyMs，
 *   绝不炸、不写 NaN/0；
 * - loopStartMs / toFirstStatusMs / toFirstModelByteMs 均相对 consumerEnteredAt。
 *
 * C 部分增补（2026-09-10 第二批）：queueLatencyMs 是混合段，拆成
 * queueDispatchMs（纯 CF Queue 派发）+ selfRefHopMs（服务绑定跳 + OpenNext
 * 动态 import）。消费者在 fetch 内部路由前打时刻与 invocation 序号，经
 * 请求头交给内部路由；workerd 的 Date.now() 在无 I/O 期间冻结，时间戳测
 * 不出 isolate 冷启动，consumerSeq === 1 才是"冷 isolate"标记。另以
 * modelRequestSentAt 把「首条 status → 首个模型字节」拆开，realModelTtftMs
 * 是真实模型 TTFT。
 *
 * 各时刻的记录点：consumerEnteredAt 由内部路由（或 executePlanAgentRun 的
 * SSE 兜底）记录；loopStartedAt 在 runPlanAgent 开头；firstStatusAt 挂在
 * forwardEvent（startupStatus 的首条 status 也走它）；firstModelByteAt 挂在
 * 模型 onDelta 回调。
 */

export type RunTimings = {
  /** 派发信道（P1-A 埋点）：queue / do / inline；随 modelUsage.timings 落库 */
  transport?: 'queue' | 'do' | 'inline'
  /** 队列消息的入队时刻（ISO）；SSE 内联路径没有 */
  enqueuedAt?: string
  /** 消费入口时刻（ISO）：内部路由在入口记录，SSE 路径由 executePlanAgentRun 记 */
  consumerEnteredAt: string
  /** 消费者 fetch 内部路由前打的时刻（ISO）；旧版消费者在途消息/SSE 路径没有 */
  consumerBatchAt?: string
  /** 消费者 isolate 的 invocation 序号（1 = 冷 isolate：本次 invocation 跑过全局作用域） */
  consumerSeq?: number
  /** runPlanAgent 进入的时刻（ISO） */
  loopStartedAt: string
  /** 首条 status 事件发出的时刻（含 startupStatus 发出的首条） */
  firstStatusAt?: string
  /** 首次模型请求发出的时刻（重试与多轮循环只记第一次） */
  modelRequestSentAt?: string
  /** 首个模型 delta 到达的时刻 */
  firstModelByteAt?: string
  /** consumerEnteredAt - enqueuedAt；无 enqueuedAt 或不可解析时省略 */
  queueLatencyMs?: number
  /** consumerBatchAt - enqueuedAt：纯 CF Queue 派发；无消费者戳时省略 */
  queueDispatchMs?: number
  /** consumerEnteredAt - consumerBatchAt：服务绑定跳 + OpenNext 动态 import */
  selfRefHopMs?: number
  /** loopStartedAt - consumerEnteredAt（内部路由 + 前置数据库往返开销） */
  loopStartMs: number
  /** modelRequestSentAt - consumerEnteredAt */
  toModelRequestMs?: number
  /** firstStatusAt - consumerEnteredAt */
  toFirstStatusMs?: number
  /** firstModelByteAt - modelRequestSentAt：真实模型 TTFT */
  realModelTtftMs?: number
  /** firstModelByteAt - consumerEnteredAt */
  toFirstModelByteMs?: number
}

/** 收集器种子：时刻由上游（内部路由 / executePlanAgentRun）记录后注入 */
export type RunTimingSeed = {
  /** 派发信道标记（P1-A）：内部路由读 x-plan-agent-transport 头注入；内联路径 'inline'；缺省省略 */
  transport?: 'queue' | 'do' | 'inline'
  enqueuedAt?: string
  consumerEnteredAt: string
  /** 消费者戳（fetch 前时刻 + invocation 序号）：内部路由解析请求头后注入；缺省整体省略 */
  consumerBatchAt?: string
  consumerSeq?: number
}

/**
 * 队列投递延迟（毫秒）：enqueuedAt 缺省（SSE 内联路径）或不可解析时返回
 * undefined，调用方据此省略该字段——绝不产出 NaN。
 */
export function queueLatencyMsOf(enqueuedAt: string | undefined, consumerEnteredMs: number): number | undefined {
  if (!enqueuedAt) return undefined
  const enqueuedMs = Date.parse(enqueuedAt)
  if (!Number.isFinite(enqueuedMs) || !Number.isFinite(consumerEnteredMs)) return undefined
  return consumerEnteredMs - enqueuedMs
}

/** 纯队列派发段（毫秒）：consumerBatchAt - enqueuedAt；任一缺省/不可解析时返回 undefined */
export function queueDispatchMsOf(enqueuedAt: string | undefined, consumerBatchMs: number): number | undefined {
  if (!enqueuedAt) return undefined
  const enqueuedMs = Date.parse(enqueuedAt)
  if (!Number.isFinite(enqueuedMs) || !Number.isFinite(consumerBatchMs)) return undefined
  return consumerBatchMs - enqueuedMs
}

/** 服务绑定跳段（毫秒）：consumerEnteredAt - consumerBatchAt；consumerBatchAt 缺省/不可解析时返回 undefined */
export function selfRefHopMsOf(consumerBatchAt: string | undefined, consumerEnteredMs: number): number | undefined {
  if (!consumerBatchAt) return undefined
  const consumerBatchMs = Date.parse(consumerBatchAt)
  if (!Number.isFinite(consumerBatchMs) || !Number.isFinite(consumerEnteredMs)) return undefined
  return consumerEnteredMs - consumerBatchMs
}

export type ConsumerBatchStamp = {
  /** epoch ms 原始值（内部路由日志与差值计算用，不再二次解析） */
  consumerBatchMs: number
  /** 同一时刻的 ISO 表示（落库格式与其余 timings 时刻一致） */
  consumerBatchAt: string
  /** invocation 序号（1 = 冷 isolate） */
  consumerSeq: number
}

/**
 * 解析消费者请求头（epoch ms 时刻 + 整数 invocation 序号）。任一头缺失、
 * 为空或不可解析（旧版消费者的在途消息、本地/测试路径）→ undefined，
 * 调用方据此把四个派生字段整体省略——绝不写 0/NaN。
 */
export function parseConsumerBatchStamp(
  batchHeader: string | null,
  seqHeader: string | null,
): ConsumerBatchStamp | undefined {
  if (batchHeader === null || seqHeader === null) return undefined
  const batchRaw = batchHeader.trim()
  const seqRaw = seqHeader.trim()
  if (batchRaw === '' || seqRaw === '') return undefined
  const consumerBatchMs = Number(batchRaw)
  const consumerSeq = Number(seqRaw)
  if (!Number.isFinite(consumerBatchMs) || !Number.isInteger(consumerSeq)) return undefined
  return { consumerBatchMs, consumerBatchAt: new Date(consumerBatchMs).toISOString(), consumerSeq }
}

export type RunTimingCollector = {
  /** runPlanAgent 进入时调用一次 */
  markLoopStarted(): void
  /** 首条 status 经过 emit 链路时调用（重复调用只记第一次） */
  markStatus(): void
  /** 首次模型请求发出前调用（重试与多轮循环重复调用只记第一次） */
  markModelRequestSent(): void
  /** 首个模型 delta 到达时调用（重复调用只记第一次） */
  markModelByte(): void
  /**
   * 当前快照；loopStarted 尚未标记或种子时刻不可解析时返回 undefined
   * （调用方整体省略 timings，不写半截数据）
   */
  snapshot(): RunTimings | undefined
}

const toIso = (ms: number): string => new Date(ms).toISOString()

export function createRunTimingCollector(
  seed: RunTimingSeed,
  now: () => number = () => Date.now(),
): RunTimingCollector {
  const consumerEnteredMs = Date.parse(seed.consumerEnteredAt)
  let loopStartedMs: number | undefined
  let firstStatusMs: number | undefined
  let modelRequestSentMs: number | undefined
  let firstModelByteMs: number | undefined
  return {
    markLoopStarted() {
      if (loopStartedMs === undefined) loopStartedMs = now()
    },
    markStatus() {
      if (firstStatusMs === undefined) firstStatusMs = now()
    },
    markModelRequestSent() {
      if (modelRequestSentMs === undefined) modelRequestSentMs = now()
    },
    markModelByte() {
      if (firstModelByteMs === undefined) firstModelByteMs = now()
    },
    snapshot() {
      if (loopStartedMs === undefined || !Number.isFinite(consumerEnteredMs)) return undefined
      const timings: RunTimings = {
        consumerEnteredAt: seed.consumerEnteredAt,
        loopStartedAt: toIso(loopStartedMs),
        loopStartMs: loopStartedMs - consumerEnteredMs,
      }
      if (seed.transport) timings.transport = seed.transport
      if (seed.enqueuedAt) timings.enqueuedAt = seed.enqueuedAt
      const queueLatencyMs = queueLatencyMsOf(seed.enqueuedAt, consumerEnteredMs)
      if (queueLatencyMs !== undefined) timings.queueLatencyMs = queueLatencyMs
      // 队列段拆分（C 部分）：种子带消费者戳才有这四个字段（内部路由保证
      // 两个头要么都解析成功要么整体不注入；此处按可解析性兜底）
      const consumerBatchMs = seed.consumerBatchAt === undefined ? NaN : Date.parse(seed.consumerBatchAt)
      if (seed.consumerBatchAt && Number.isFinite(consumerBatchMs)) {
        timings.consumerBatchAt = seed.consumerBatchAt
        if (seed.consumerSeq !== undefined) timings.consumerSeq = seed.consumerSeq
        const queueDispatchMs = queueDispatchMsOf(seed.enqueuedAt, consumerBatchMs)
        if (queueDispatchMs !== undefined) timings.queueDispatchMs = queueDispatchMs
        const selfRefHopMs = selfRefHopMsOf(seed.consumerBatchAt, consumerEnteredMs)
        if (selfRefHopMs !== undefined) timings.selfRefHopMs = selfRefHopMs
      }
      if (firstStatusMs !== undefined) {
        timings.firstStatusAt = toIso(firstStatusMs)
        timings.toFirstStatusMs = firstStatusMs - consumerEnteredMs
      }
      if (modelRequestSentMs !== undefined) {
        timings.modelRequestSentAt = toIso(modelRequestSentMs)
        timings.toModelRequestMs = modelRequestSentMs - consumerEnteredMs
      }
      if (firstModelByteMs !== undefined) {
        timings.firstModelByteAt = toIso(firstModelByteMs)
        timings.toFirstModelByteMs = firstModelByteMs - consumerEnteredMs
        if (modelRequestSentMs !== undefined) {
          timings.realModelTtftMs = firstModelByteMs - modelRequestSentMs
        }
      }
      return timings
    },
  }
}
