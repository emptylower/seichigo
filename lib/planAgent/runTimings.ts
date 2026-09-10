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
 * 各时刻的记录点：consumerEnteredAt 由内部路由（或 executePlanAgentRun 的
 * SSE 兜底）记录；loopStartedAt 在 runPlanAgent 开头；firstStatusAt 挂在
 * forwardEvent（startupStatus 的首条 status 也走它）；firstModelByteAt 挂在
 * 模型 onDelta 回调。
 */

export type RunTimings = {
  /** 队列消息的入队时刻（ISO）；SSE 内联路径没有 */
  enqueuedAt?: string
  /** 消费入口时刻（ISO）：内部路由在入口记录，SSE 路径由 executePlanAgentRun 记 */
  consumerEnteredAt: string
  /** runPlanAgent 进入的时刻（ISO） */
  loopStartedAt: string
  /** 首条 status 事件发出的时刻（含 startupStatus 发出的首条） */
  firstStatusAt?: string
  /** 首个模型 delta 到达的时刻 */
  firstModelByteAt?: string
  /** consumerEnteredAt - enqueuedAt；无 enqueuedAt 或不可解析时省略 */
  queueLatencyMs?: number
  /** loopStartedAt - consumerEnteredAt（内部路由 + 前置数据库往返开销） */
  loopStartMs: number
  /** firstStatusAt - consumerEnteredAt */
  toFirstStatusMs?: number
  /** firstModelByteAt - consumerEnteredAt */
  toFirstModelByteMs?: number
}

/** 收集器种子：时刻由上游（内部路由 / executePlanAgentRun）记录后注入 */
export type RunTimingSeed = {
  enqueuedAt?: string
  consumerEnteredAt: string
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

export type RunTimingCollector = {
  /** runPlanAgent 进入时调用一次 */
  markLoopStarted(): void
  /** 首条 status 经过 emit 链路时调用（重复调用只记第一次） */
  markStatus(): void
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
  let firstModelByteMs: number | undefined
  return {
    markLoopStarted() {
      if (loopStartedMs === undefined) loopStartedMs = now()
    },
    markStatus() {
      if (firstStatusMs === undefined) firstStatusMs = now()
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
      if (seed.enqueuedAt) timings.enqueuedAt = seed.enqueuedAt
      const queueLatencyMs = queueLatencyMsOf(seed.enqueuedAt, consumerEnteredMs)
      if (queueLatencyMs !== undefined) timings.queueLatencyMs = queueLatencyMs
      if (firstStatusMs !== undefined) {
        timings.firstStatusAt = toIso(firstStatusMs)
        timings.toFirstStatusMs = firstStatusMs - consumerEnteredMs
      }
      if (firstModelByteMs !== undefined) {
        timings.firstModelByteAt = toIso(firstModelByteMs)
        timings.toFirstModelByteMs = firstModelByteMs - consumerEnteredMs
      }
      return timings
    },
  }
}
