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
 *
 * P2-B 增补（2026-09-11 Phase 2-B，Astra 评审后修订）：DO 派发段拆分——
 * queueDispatchMs 里的 `POST 派发 → 消费者 fetch` 混合段由 DO 派发器经
 * 请求头交来：doIngressMs（POST 派发 → DO fetch 入口）+ doAcceptMs（入口
 * → setAlarm 成功的接纳完成）+ acceptToAlarmMs（接纳完成 → alarm 触发）+
 * alarmPreludeMs（alarm 入口 → handler 调用前，含三次存储 IO）+
 * alarmToEntryMs（handler 调用前 → 内部路由入口）。五段之和 ===
 * consumerEnteredAt − dispatchedAt（≈ queueDispatchMs 口径）。另带 moduleId
 * / doInstanceId（模块实例与 DO 对象实例分开——"对象重建但模块没重建"与
 * "模块全新"在 consumerSeq=1 上分不出来）、isolateAgeMs（alarm 时刻 − DO
 * isolate 模块求值时刻——6/6 次 consumerSeq=1 疑似每次 alarm 都在全新
 * isolate 上跑，需要数据证实）与 alarmAttempt（本次 alarm 的尝试序号）。
 * 头缺失/非法时对应字段省略，绝不写 0/NaN。queueDispatchMs 本身保留不动
 * （历史数据可比）。
 */

export type RunTimings = {
  /** 派发信道（P1-A 埋点）：queue / do / do-local（P1_1 本 isolate 直调）/ inline；随 modelUsage.timings 落库 */
  transport?: 'queue' | 'do' | 'do-local' | 'inline'
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
  /** P2-B：doEnteredAt − dispatchedAt（POST 派发 → DO fetch 入口）。注意 dispatchedAt（POST 里取，软截止也在用）与消息体 enqueuedAt 不是同一个戳 */
  doIngressMs?: number
  /** P2-B：acceptedDoneAt − doEnteredAt（DO 入口 → setAlarm 成功的接纳完成）；旧 state 缺 acceptedDoneAt 时省略 */
  doAcceptMs?: number
  /** P2-B：alarmAt − acceptedDoneAt（接纳完成 → alarm 触发）；同上缺戳时省略 */
  acceptToAlarmMs?: number
  /** P2-B：alarm 入口 → handler 调用前（含 get payload/state + put state 三次存储 IO） */
  alarmPreludeMs?: number
  /** P2-B：consumerEnteredAt − (alarmAt + alarmPreludeMs)（handler 调用前 → 内部路由入口；do-local 就是 handler.fetch 的路由开销） */
  alarmToEntryMs?: number
  /** P2-B：DO worker 模块实例 id（模块求值时生成一次；区分模块重建与对象重建） */
  moduleId?: string
  /** P2-B：DO 对象实例 id（构造函数生成） */
  doInstanceId?: string
  /** P2-B：DO isolate 年龄（alarm 时刻 − 模块求值时刻）；冷 isolate 判据 */
  isolateAgeMs?: number
  /** P2-B：本次 alarm 的尝试序号（从 1 起） */
  alarmAttempt?: number
}

/** 收集器种子：时刻由上游（内部路由 / executePlanAgentRun）记录后注入 */
export type RunTimingSeed = {
  /**
   * 派发信道标记（P1-A）：内部路由读 x-plan-agent-transport 头注入
   *（P1_1：叠加 x-plan-agent-local: 1 → 'do-local'，本 isolate 直调）；
   * 内联路径 'inline'；缺省省略
   */
  transport?: 'queue' | 'do' | 'do-local' | 'inline'
  enqueuedAt?: string
  consumerEnteredAt: string
  /** 消费者戳（fetch 前时刻 + invocation 序号）：内部路由解析请求头后注入；缺省整体省略 */
  consumerBatchAt?: string
  consumerSeq?: number
  /**
   * P2-B：DO 派发段戳——内部路由解析 x-plan-agent-do-* / x-plan-agent-alarm-*
   * 等八个头后注入；缺省整体省略。dispatchedAt 来自队列消息本体（POST 派发
   * 时刻，P0-B 已有字段，≠ enqueuedAt），供 doIngressMs 计算。
   */
  dispatchedAt?: string
  doEnteredAt?: string
  /** 接纳完成戳（setAlarm 成功后）；旧部署在途 state 缺省 → 对应差值省略 */
  acceptedDoneAt?: string
  alarmAt?: string
  alarmPreludeMs?: number
  isolateAgeMs?: number
  alarmAttempt?: number
  moduleId?: string
  doInstanceId?: string
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

export type DispatchSegmentStamp = {
  /** DO fetch 入口时刻（epoch ms，x-plan-agent-do-entered-at） */
  doEnteredMs: number
  /** 接纳完成时刻（epoch ms，setAlarm 成功后取；旧 state 缺该字段时 undefined） */
  acceptedDoneMs?: number
  /** alarm 触发时刻（epoch ms，x-plan-agent-alarm-at） */
  alarmMs: number
  /** alarm 入口 → handler 调用前（ms，含三次存储 IO） */
  alarmPreludeMs: number
  /** DO isolate 年龄（ms：alarm 时刻 − 模块求值时刻） */
  isolateAgeMs: number
  /** 本次 alarm 的尝试序号（从 1 起） */
  alarmAttempt: number
  /** worker 模块实例 id */
  moduleId: string
  /** DO 对象实例 id */
  doInstanceId: string
}

/**
 * P2-B：解析 DO 派发器随内部路由请求带来的八个埋点头（与
 * parseConsumerBatchStamp 同样宽容：任一**必需**头缺失、为空或不可解析 →
 * undefined，调用方据此整体省略——绝不写 0/NaN）。例外是
 * x-plan-agent-do-accepted-at：它承载的 acceptedDoneAt 是滚动部署后才有的
 * state 新字段，在途旧 state 没有它 → 仅该值缺省（acceptedDoneMs:
 * undefined），其余字段照常解析。
 */
export function parseDispatchSegmentStamp(headers: {
  doEnteredAt: string | null
  doAcceptedAt: string | null
  alarmAt: string | null
  alarmPreludeMs: string | null
  isolateAgeMs: string | null
  alarmAttempt: string | null
  moduleId: string | null
  doInstanceId: string | null
}): DispatchSegmentStamp | undefined {
  const num = (raw: string | null): number | undefined => {
    if (raw === null) return undefined
    const trimmed = raw.trim()
    if (trimmed === '') return undefined
    const value = Number(trimmed)
    return Number.isFinite(value) ? value : undefined
  }
  const ident = (raw: string | null): string | undefined => {
    if (raw === null) return undefined
    const trimmed = raw.trim()
    return trimmed === '' ? undefined : trimmed
  }
  const doEnteredMs = num(headers.doEnteredAt)
  const alarmMs = num(headers.alarmAt)
  const alarmPreludeMs = num(headers.alarmPreludeMs)
  const isolateAgeMs = num(headers.isolateAgeMs)
  const alarmAttempt = num(headers.alarmAttempt)
  const moduleId = ident(headers.moduleId)
  const doInstanceId = ident(headers.doInstanceId)
  if (
    doEnteredMs === undefined ||
    alarmMs === undefined ||
    alarmPreludeMs === undefined ||
    isolateAgeMs === undefined ||
    alarmAttempt === undefined ||
    !Number.isInteger(alarmAttempt) ||
    moduleId === undefined ||
    doInstanceId === undefined
  ) {
    return undefined
  }
  const acceptedDoneMs = num(headers.doAcceptedAt)
  return {
    doEnteredMs,
    ...(acceptedDoneMs !== undefined ? { acceptedDoneMs } : {}),
    alarmMs,
    alarmPreludeMs,
    isolateAgeMs,
    alarmAttempt,
    moduleId,
    doInstanceId,
  }
}

/** P2-B：POST 派发 → DO fetch 入口（毫秒）；dispatchedAt 缺省/不可解析时返回 undefined */
export function doIngressMsOf(dispatchedAt: string | undefined, doEnteredMs: number): number | undefined {
  if (!dispatchedAt) return undefined
  const dispatchedMs = Date.parse(dispatchedAt)
  if (!Number.isFinite(dispatchedMs) || !Number.isFinite(doEnteredMs)) return undefined
  return doEnteredMs - dispatchedMs
}

/** P2-B：DO 入口 → 接纳完成（setAlarm 成功后，毫秒）；任一不可解析时返回 undefined */
export function doAcceptMsOf(doEnteredMs: number, acceptedDoneMs: number): number | undefined {
  if (!Number.isFinite(doEnteredMs) || !Number.isFinite(acceptedDoneMs)) return undefined
  return acceptedDoneMs - doEnteredMs
}

/** P2-B：接纳完成 → alarm 触发（毫秒）；任一不可解析时返回 undefined */
export function acceptToAlarmMsOf(acceptedDoneMs: number, alarmMs: number): number | undefined {
  if (!Number.isFinite(acceptedDoneMs) || !Number.isFinite(alarmMs)) return undefined
  return alarmMs - acceptedDoneMs
}

/**
 * P2-B：handler 调用前（alarmAt + alarmPreludeMs）→ 内部路由入口（毫秒）。
 * alarmPreludeMs 缺省/不可解析时返回 undefined（没有前奏戳就算不出这一段）。
 */
export function alarmToEntryMsOf(
  alarmMs: number,
  alarmPreludeMs: number | undefined,
  consumerEnteredMs: number,
): number | undefined {
  if (alarmPreludeMs === undefined || !Number.isFinite(alarmPreludeMs)) return undefined
  if (!Number.isFinite(alarmMs) || !Number.isFinite(consumerEnteredMs)) return undefined
  return consumerEnteredMs - (alarmMs + alarmPreludeMs)
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
      // P2-B：DO 派发段拆分（种子由内部路由解析 DO 埋点头后注入；此处按
      // 可解析性兜底，缺戳时对应字段省略——绝不写 0/NaN）
      if (seed.moduleId) timings.moduleId = seed.moduleId
      if (seed.doInstanceId) timings.doInstanceId = seed.doInstanceId
      if (seed.alarmPreludeMs !== undefined && Number.isFinite(seed.alarmPreludeMs)) {
        timings.alarmPreludeMs = seed.alarmPreludeMs
      }
      if (seed.isolateAgeMs !== undefined && Number.isFinite(seed.isolateAgeMs)) {
        timings.isolateAgeMs = seed.isolateAgeMs
      }
      if (seed.alarmAttempt !== undefined && Number.isInteger(seed.alarmAttempt)) {
        timings.alarmAttempt = seed.alarmAttempt
      }
      const doEnteredMs = seed.doEnteredAt === undefined ? NaN : Date.parse(seed.doEnteredAt)
      const alarmMs = seed.alarmAt === undefined ? NaN : Date.parse(seed.alarmAt)
      const acceptedDoneMs = seed.acceptedDoneAt === undefined ? undefined : Date.parse(seed.acceptedDoneAt)
      if (seed.doEnteredAt && Number.isFinite(doEnteredMs)) {
        const doIngressMs = doIngressMsOf(seed.dispatchedAt, doEnteredMs)
        if (doIngressMs !== undefined) timings.doIngressMs = doIngressMs
        if (acceptedDoneMs !== undefined && Number.isFinite(acceptedDoneMs)) {
          const doAcceptMs = doAcceptMsOf(doEnteredMs, acceptedDoneMs)
          if (doAcceptMs !== undefined) timings.doAcceptMs = doAcceptMs
          if (Number.isFinite(alarmMs)) {
            const acceptToAlarmMs = acceptToAlarmMsOf(acceptedDoneMs, alarmMs)
            if (acceptToAlarmMs !== undefined) timings.acceptToAlarmMs = acceptToAlarmMs
          }
        }
      }
      if (seed.alarmAt && Number.isFinite(alarmMs)) {
        const alarmToEntryMs = alarmToEntryMsOf(alarmMs, seed.alarmPreludeMs, consumerEnteredMs)
        if (alarmToEntryMs !== undefined) timings.alarmToEntryMs = alarmToEntryMs
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
