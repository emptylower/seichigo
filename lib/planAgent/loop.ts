import type OpenAI from 'openai'
import type { Prisma } from '@prisma/client'
import { executePlanTool, PLAN_AGENT_TOOLS, type PlanAgentToolDeps } from './tools'
import { PLAN_AGENT_SYSTEM_PROMPT } from './prompt'
import { RunFencedError } from './runFence'
import { AskUserSignal, type AskUserPayload } from './askUser'
import { agentErrorMessage } from './netErrors'
import { runInBackground } from './serverDeps'
import { parseDaymapPayload, type DaymapMessagePayload } from '@/lib/tripPlan/view'
import { buildStageContext, derivePlanStage, type PlanStage } from './stage'
import { createEnrichBudget, type EnrichReport } from './enrich/types'
import type { PlanQualityReport } from './gates'
import { planNeedsContinuation, runEnrichContinuation } from './enrichContinuation'
import {
  assertNoOrphanToolCalls,
  looksLikeUnansweredUserQuestion,
  PROTOCOL_ERROR_MESSAGE,
  PROTOCOL_RETRY_INSTRUCTION,
} from './protocolGuard'
import { EMPTY_TURN_ERROR_MESSAGE, EMPTY_TURN_RETRY_INSTRUCTION } from './emptyTurn'
import { summarizeToolArgs, summarizeToolResult, toolStatusPhrase } from './statusPhrases'
import { serverText } from './serverText'
import { createRunLiveWriter, type RunLiveWriter } from './runLive'
import { createEventCoalescer } from './eventCoalescer'
import { createLeaseWatcher, isUserStoppedAbort, stopEvidencePresent, stoppedLogExists } from './stop'
import { createStartupStatusEmitter } from './startupStatus'
import { describePlanAgentModel } from './api'
import { sanitizeHistoryForModel } from './historySanitize'
import { createRunCostTracker, type RunCostDeps } from './runCost'
import { createRunTimingCollector, type RunTimingSeed } from './runTimings'
import { withFencing } from './loopFencing'
import { forbiddenToolsOf, tierPromptNote, type Entitlements } from '@/lib/billing/tiers'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

export type PlanAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  /** 第十一轮 A3（§0）：用户显式停止——随后紧跟 done；不落库 */
  | { type: 'stopped' }
  /**
   * 第十一轮 A3（§0）：每回合第一次模型调用结束后的模型信息（仅 SSE，不落库）。
   * reasoning=false 表示该次调用没收到任何思考增量——前端据此提示"当前模型
   * 不公开思考过程，仅显示工具进度"。
   */
  | { type: 'model_info'; providerName: string; model: string; reasoning: boolean }
  /** 瞬时遥测：当前工具在做什么的中文短语（仅 SSE，不落库） */
  | { type: 'status'; phase: string }
  /** 瞬时遥测：单个工具调用的开始/结束帧（仅 SSE，不落库） */
  | { type: 'tool_call'; id: string; name: string; argsSummary: string; status: 'running' | 'done'; durationMs?: number; resultSummary?: string }
  /** 瞬时遥测：DeepSeek reasoning_content 的流式增量（仅 SSE，不落库） */
  | { type: 'reasoning'; delta: string }
  /** ask_user 发起的结构化提问：前端渲染交互组件，本轮对话就此结束 */
  | ({ type: 'ask' } & AskUserPayload)
  /**
   * save_plan_days 成功后实时下发的行程交付快照：与落库 kind=daymap 消息
   * 同构（同一载荷解析器），前端按 revisionId 去重后插入聊天时间线。
   */
  | DaymapMessagePayload

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

/**
 * 模型调用返回的完整 message：OpenAI 协议字段之外，还带 DeepSeek 推理模型的
 * 非标准 reasoning_content 与流末帧的 finish_reason（stop=主动结束、
 * length=被输出预算截断）。两个扩展字段都只存在于内存，落库前会被剥掉。
 */
export type PlanAgentChatMessage = OpenAI.Chat.Completions.ChatCompletionMessage & {
  reasoning_content?: string
  finish_reason?: string | null
}

/**
 * 模型调用增量回调：reasoning/content 是本帧收到的增量片段本身（非累积值）。
 * 只接受一个参数的实现仍然可以赋给本类型（多余形参可不声明），存量 mock 不受影响。
 */
export type CreateMessageFn = (
  params: {
    messages: ChatMessageParam[]
    tools: OpenAI.Chat.Completions.ChatCompletionTool[]
    /** 第十一轮 A3：租约看守触发停止时 abort（createChatCompletion 一路传到 HTTP 层） */
    signal?: AbortSignal
  },
  onDelta?: (delta: { reasoning?: string; content?: string }) => void,
) => Promise<PlanAgentChatMessage>

export type PlanAgentDeps = {
  createMessage: CreateMessageFn
  repo: TripPlanRepo
  planId: string
  toolDeps: PlanAgentToolDeps
  maxIterations?: number
  signal?: AbortSignal
  /** 路由已在配额事务里落库人类消息时置 true，历史里已含该消息，循环不再重复 push/落库 */
  userMessagePersisted?: boolean
  /**
   * beginAgentRun 返回的持有者 token。传入后循环在每轮模型调用返回时都会
   * 用它做栅栏检查（fencing）——busy 位的 TTL 只是启发式，本请求可能仍然
   * 存活，只是模型响应慢；一旦发现自己已被新请求接管就立刻停止写入，避免
   * 与新请求交叉写同一份历史。不传时不做检查（供内部测试等不涉及并发场
   * 景的调用方使用）。
   */
  runToken?: string
  /**
   * 后台任务派发（R4 补齐续跑）：优先注入 Cloudflare ctx 绑定后的 waitUntil
   * （route 侧装配）；缺省时用 void promise 浮动执行。
   */
  runInBackground?: (task: () => Promise<unknown>) => void
  /**
   * 第八轮 A3：resume 回合的中断说明。拼进本回合 [系统状态] 前缀（仅在
   * 发给模型的内存 messages 上，不落库）——模型基于已保存进度继续而不
   * 重复已完成的工具调用。
   */
  resumeNote?: string
  /**
   * 第九轮 L1：忙碌租约续租（route 注入，封装 renewAgentRun；被接管时抛
   * RunFencedError，按现有栅栏语义静默结束本 run）。循环在每次模型调用前
   * 与每次工具执行前续租，并透传给 save_plan_days 这类长工具在内部续租；
   * 不传（内部测试等不涉及并发的调用方）不续租。
   */
  renewLease?: () => Promise<void>
  /**
   * 第十一轮 A3：停止检查（route 注入 isAgentRunStopped 封装）。模型流式
   * 期间租约看守定期轮询（默认 3 秒，L7），发现 token 已不匹配就 abort 模型请求；
   * 不传（内部测试等）时流式期不检测停止（renewLease 的栅栏语义仍生效）。
   */
  isStopped?: () => Promise<boolean>
  /**
   * §0.6 站点语言（route 从 getLocale() 取）：只影响服务端固定文案（思维链
   * 短语、ask 收尾备注、网络错误），不参与模型回复语言（由提示词的
   * "回复语言"段约束模型自行跟随用户）。缺省 zh。
   */
  locale?: SupportedLocale
  /**
   * 2026-09-10 B 部分埋点：启动链路分段计时的种子（executePlanAgentRun 注入；
   * 队列路径含 enqueuedAt，SSE 内联路径只有 consumerEnteredAt）。缺省整体
   * 不记 timings（不涉并发的旧测试直调不受影响）。
   */
  timingSeed?: RunTimingSeed
  /** B 部分埋点：可注入时钟（毫秒）；缺省 Date.now。测试注入假时钟驱动分段 */
  now?: () => number
  /**
   * 2026-09-06 §0.5 软截止时间（epoch ms）：队列消费者单次调用有 15 分钟
   * 硬上限，内部路由传入 start + 13 min。循环每次迭代开头检查，到点即按
   * 客户端断开同一收尾（interrupted=true：写 stage=interrupted 日志、清实况
   * 行、不发 done、不派发补齐续跑），客户端靠现有"上次被打断 → 续跑"路径
   * 接着跑。SSE 路径不传。
   */
  deadlineAt?: number
  /** 档位能力表（设计 §5）：过滤工具、附注提示词、初始化补齐预算上限；缺省全开 */
  entitlements?: Entitlements
} & RunCostDeps

const DEFAULT_MAX_ITERATIONS = 12

/** M1：writer 收尾最多阻塞 run 这么久（库慢时 SSE 也要按时收束） */
const RUN_LIVE_FINISH_TIMEOUT_MS = 2_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isChatMessage(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'role' in value
}

/**
 * 第八轮 A1：是否客户端断开（刷新/断网）导致的中止——route 用
 * `DOMException('client_disconnected', 'AbortError')` 作为 abort reason，
 * 与服务端主动结束（无 reason）区分开。
 */
function isClientDisconnected(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false
  const reason: unknown = signal.reason
  return (
    typeof reason === 'object' && reason !== null && (reason as { message?: unknown }).message === 'client_disconnected'
  )
}

/**
 * 修复损坏的历史再回放：带 tool_calls 的 assistant 消息必须紧跟全部对应的
 * tool 回执，否则 OpenAI 协议回放会被拒。崩溃或历史并发交错会留下悬空
 * tool_calls / 孤儿 tool 回执——不清理的话该计划的后续对话会永久报错。
 */
export function sanitizeChatHistory(history: ChatMessageParam[]): ChatMessageParam[] {
  const out: ChatMessageParam[] = []
  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    if (msg.role === 'tool') continue // 走到这的 tool 都是孤儿（配对的在下面整组消费）
    const toolCalls = msg.role === 'assistant' && 'tool_calls' in msg ? msg.tool_calls ?? [] : []
    if (msg.role === 'assistant' && toolCalls.length) {
      const pending = new Set(toolCalls.map((c) => c.id))
      const replies: ChatMessageParam[] = []
      let j = i + 1
      while (j < history.length && history[j].role === 'tool') {
        const reply = history[j] as Extract<ChatMessageParam, { role: 'tool' }>
        if (pending.delete(reply.tool_call_id)) replies.push(reply)
        j++
      }
      if (pending.size === 0) out.push(msg, ...replies)
      i = j - 1
      continue
    }
    out.push(msg)
  }
  return out
}

export async function runPlanAgent(
  deps: PlanAgentDeps,
  userMessage: string,
  onEvent: (event: PlanAgentEvent) => void,
): Promise<void> {
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const runStartedAt = Date.now()
  // §0.6：本 run 的服务端固定文案语言（status/summary/netError/askUserNote）
  const locale = deps.locale ?? 'zh'

  // B 部分埋点（2026-09-10）：启动链路分段计时（runTimings.ts）——loopStarted
  // 在此记，首条 status / 首模型 delta 分别挂在 forwardEvent 与 onDelta 上
  const runTiming = deps.timingSeed ? createRunTimingCollector(deps.timingSeed, deps.now) : undefined
  runTiming?.markLoopStarted()

  // 第七轮 A1：运行实况旁路写库（刷新恢复用）。只在持有 runToken 时启用；
  // emit 把事件同时发给 SSE 与 writer（节流落库），不改变既有事件行为。
  // 2026-09-10 首帧优化：构造上移到函数体最前——listMessages/getPlan/首次
  // 模型调用之前的启动步骤也要发 status 实况，晚于此创建没人接收
  const runLiveWriter: RunLiveWriter | null = deps.runToken
    ? createRunLiveWriter({ repo: deps.repo, planId: deps.planId, runToken: deps.runToken })
    : null
  // 第九轮 A4：事件计数素材——run 结束打一条 summary 日志；被平台硬杀时
  // 这条不会出现（finally 都跑不到），可作为日志侧证据
  let emittedEvents = 0
  let reasoningChars = 0
  const forwardEvent = (event: PlanAgentEvent) => {
    emittedEvents += 1
    if (event.type === 'reasoning') reasoningChars += event.delta.length
    // B 部分埋点：首条 status（含 startupStatus 发出的首条）经过这里
    if (event.type === 'status') runTiming?.markStatus()
    onEvent(event)
    runLiveWriter?.onEvent(event)
  }
  // 第九轮 A2：emit 经事件合并器——reasoning/text 增量按时间/字数阈值合并
  // 成单条事件再下发（SSE 与实况 writer 都在合并器之后接收）；每 token 一条
  // SSE 事件是长 run 的 CPU 大头。done/error 前强制 flush 保证内容完整
  const eventCoalescer = createEventCoalescer(forwardEvent)
  const emit = (event: PlanAgentEvent) => eventCoalescer.emit(event)

  // 2026-09-10 首帧优化：启动阶段在真实步骤上发 status 实况（见
  // startupStatus.ts）。先确认仍持有 busy 位——被接管（队列滞留后启动）的
  // run 不发也不落库，旧 token 落笔会覆盖新 run 的实况行（runLive M2 语义）
  let holdsRun = true
  if (deps.runToken) {
    try {
      holdsRun = !(await deps.repo.isAgentRunStopped(deps.planId, deps.runToken))
    } catch {
      // 读失败不拦启动：后续栅栏/续租仍会正确拦截被接管的 run
    }
  }
  const emitStartup = createStartupStatusEmitter(emit, locale, holdsRun)

  emitStartup('readHistory')
  const history = await deps.repo.listMessages(deps.planId)

  const userParam: ChatMessageParam = { role: 'user', content: userMessage }
  // 阶段推断需要包含"本轮这条 human 消息"的完整历史（revise 判定依赖它）
  let stageHistory = history
  if (!deps.userMessagePersisted) {
    const appended = await deps.repo.appendMessage(deps.planId, 'human', userParam as unknown as Prisma.JsonValue)
    stageHistory = [...history, appended]
  }

  // M4 阶段推断：从持久化证据（计划结构 + 最近 daymap 的 quality + 消息历史）
  // 推断当前阶段并注入本轮消息；TripPlan.stage 只是缓存，写失败可忽略
  emitStartup('checkProgress')
  let stage: PlanStage = 'works'
  let stageContext = ''
  const plan = await deps.repo.getPlan(deps.planId)
  if (plan) {
    const lastDaymap = [...stageHistory].reverse().find((m) => m.kind === 'daymap')
    const quality = lastDaymap ? parseDaymapPayload(lastDaymap.content)?.quality ?? null : null
    stage = derivePlanStage({ plan, messages: stageHistory, quality })
    stageContext = buildStageContext(stage, quality)
    try {
      await deps.repo.updateStage(deps.planId, stage)
    } catch {
      // 阶段缓存写失败不影响本轮对话
    }
  }

  // system 消息恒为原始提示词（保住前缀缓存）；阶段上下文拼进内存中最新
  // human 消息的内容前部（N5，见下方 stageContext 分支——只在内存，不落库、
  // 不进 sanitizeChatHistory 的输入——它只处理持久化历史）。第八轮 A3：
  // resume 回合的中断说明并进同一份 [系统状态]（同样只在内存）
  const statusContext = [stageContext, deps.resumeNote].filter(Boolean).join('\n')
  const messages: ChatMessageParam[] = [
    {
      role: 'system',
      content: [PLAN_AGENT_SYSTEM_PROMPT, deps.entitlements ? tierPromptNote(deps.entitlements) : null].filter(Boolean).join('\n\n'),
    },
    ...sanitizeChatHistory(
      stageHistory
        .map((m) => m.content)
        .filter(isChatMessage)
        .map((m) => m as unknown as ChatMessageParam),
    ),
  ]
  if (statusContext) {
    // N5：不再单独插入 [系统状态] user 消息（避免连续 user 消息），改为把
    // 阶段上下文拼进内存中最新 human 消息的内容前部；落库行仍是纯用户原文
    // （appendMessage 写的是 userParam，此改写只发生在发给模型的 messages
    // 数组上；sanitizeChatHistory 的输入是持久化历史，不受影响）
    const prefix = `[系统状态]\n${statusContext}\n\n[用户消息]\n`
    let lastUserIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIndex = i
        break
      }
    }
    if (lastUserIndex >= 0) {
      const target = messages[lastUserIndex]
      if (typeof target.content === 'string') {
        messages[lastUserIndex] = { ...target, content: `${prefix}${target.content}` }
      }
    } else {
      messages.push({ role: 'user', content: `[系统状态]\n${statusContext}` })
    }
  }

  // M4 运行日志素材：turnIndex 是本轮 human 消息的序号（含本轮）
  const turnIndex = stageHistory.filter((m) => m.kind === 'human').length
  const toolCallSummaries: Array<{ name: string; durationMs: number }> = []
  // 对象持有者：闭包内赋值后，外层读取不会被控制流分析窄化成 null
  const saveEvaluation: { current: { enrich: EnrichReport; quality: PlanQualityReport } | null } = { current: null }

  // runToken 存在时，所有写（含 save_plan_days/update_plan_meta 等工具触发
  // 的写）都走原子校验版本；未提供 token 的调用方（不涉及并发场景的测试）
  // 直接用裸 repo
  const runRepo = deps.runToken ? withFencing(deps.repo, deps.runToken) : deps.repo

  const enrichBudget = deps.toolDeps.enrichBudget ?? createEnrichBudget()
  if (deps.entitlements) {
    enrichBudget.places.max = deps.entitlements.placesMax
    enrichBudget.directions.max = deps.entitlements.directionsMax
  }
  const runCost = createRunCostTracker({
    enrichBudget,
    runCapMicros: deps.runCapMicros,
    maxIterations,
    withTitle: Boolean(userMessage),
    // B 部分埋点：summary 快照带上 timings（写进 modelUsage 顶层键）
    ...(runTiming ? { getTimings: runTiming.snapshot } : {}),
  })
  const forbiddenTools = deps.entitlements ? forbiddenToolsOf(deps.entitlements) : new Set<string>()
  // ChatCompletionTool 是联合类型（function 工具 + 自定义工具），只有带
  // function 的成员才有可禁用的名字；自定义工具原样保留
  const modelTools = PLAN_AGENT_TOOLS.filter((t) => !('function' in t) || !forbiddenTools.has(t.function.name))

  const toolDeps: PlanAgentToolDeps = {
    ...deps.toolDeps,
    repo: runRepo,
    // §0.6：补齐层（餐食标签等用户可见文案）按站点语言
    locale,
    // 档位卡点（设计 §5）：禁用工具集合、天数上限与补齐层能力表
    forbiddenTools,
    maxDays: deps.entitlements?.maxDays,
    entitlements: deps.entitlements,
    // 第九轮 L1：租约续租透传给工具——save_plan_days 在长补齐前后各续一次
    renewLease: deps.renewLease,
    // Google 补齐预算每个 run 创建一次：同一 run 内多次 save 共享同一份
    // directions/places 配额，避免每次 save 重置预算重烧 Google 调用
    enrichBudget,
    onPlanUpdated: () => {
      deps.toolDeps.onPlanUpdated?.()
      emit({ type: 'plan_updated' })
    },
    onDaymapSaved: (daymap) => {
      deps.toolDeps.onDaymapSaved?.(daymap)
      emit(daymap)
    },
    // save_plan_days 的门控评估结果回传（通过与拒绝都回调），run 结束写运行日志
    onSaveEvaluated: (evaluation) => {
      saveEvaluation.current = evaluation
      deps.toolDeps.onSaveEvaluated?.(evaluation)
    },
  }

  // 被新请求接管（RunFencedError）的 run 不写运行日志：它对这份计划已失去
  // 写权，接管的 run 会写下自己的日志，两条并存会污染 turn 统计
  let fenced = false
  // 第八轮 A1：客户端断开（刷新/断网）中止的 run——写 stage=interrupted
  // 日志、清实况行、不再向已关闭的 SSE 发 done（落库照常）
  let interrupted = false
  // 第十一轮 A3：用户显式停止的 run——SSE 发 stopped+done、日志 stage=stopped、
  // 实况行清空、不派发补齐续跑（§0：停止后不自动续跑，手动 resume 仍允许）
  let stopped = false
  // §0 model_info：每回合只在第一次模型调用结束后发一次
  let modelInfoEmitted = false
  let reasoningSeen = false
  // 首帧优化：首次模型调用前的最后一条启动实况——接下来是 DeepSeek 的
  // TTFT 黑屏期（1–3 秒），有这句真实状态挂着才不像卡死
  emitStartup('organize')
  try {
    // 强制 ask_user 协议守卫（M3 修订）：只要本轮响应里没有 ask_user 调用，
    // 正文又像"向用户提问"（含"解释文字 + 其它工具调用"的组合），整条响应
    // ——正文与工具调用——都被扣下：不发 SSE、不落库、不执行工具，只进
    // 内存消息并注入纠正指令重试一次。重试干净则正常继续；再犯只发可恢复
    // 的协议错误（正文依旧扣下），绝不留下无法回答的悬空提问。
    let questionGuardRetried = false
    let emptyTurnRetried = false
    outer: for (let iteration = 0; iteration < runCost.iterationLimit; iteration++) {
      if (deps.signal?.aborted) {
        interrupted = isClientDisconnected(deps.signal)
        break
      }
      // §0.5 软截止：队列消费者的硬杀兜底——到点按客户端断开同一收尾，
      // 剩余工作交给现有"上次被打断 → 续跑"路径
      if (deps.deadlineAt !== undefined && Date.now() >= deps.deadlineAt) {
        interrupted = true
        break
      }
      // 通用防线：无论哪条路径在内存消息里留下悬空 tool_calls（守卫扣下、
      // 信号中止、栅栏错误……），都在发给模型前补齐占位回执，绝不产出
      // "assistant 带 tool_calls 但无 tool 回执"的非法序列（DeepSeek 400）
      assertNoOrphanToolCalls(messages)
      // reasoning 增量逐帧透传给 SSE（content 增量不转发：最终答案等本轮结束后
      // 仍走下面那个完整 text 事件，这是"思考过程流式、答案整段"的产品取舍）
      // 第九轮 L1：模型调用前续租（职责自 route 的 createMessageWithLease 移入
      // 循环，配合 90 秒短租约——单次慢推理不会被误判过期；被接管则抛
      // RunFencedError 静默收尾）
      await deps.renewLease?.()
      // 第十一轮 A3 + L7：模型流式期间由租约看守定期轮询停止状态（默认 3
      // 秒），发现被停止就 abort 模型请求（user_stopped）——流式可能持续
      // 几十秒，栅栏只在调用间隙生效，看守保证停止在数秒内传导到在途请求
      const modelAbort = new AbortController()
      const watcher = deps.isStopped ? createLeaseWatcher({ check: deps.isStopped }) : null
      watcher?.start(modelAbort)
      let response: PlanAgentChatMessage
      try {
      // A4 补充：历史里的非法工具参数/额外字段在发送前清洗（不改内存与落库原文）
      // C 部分埋点：首次模型请求发出的时刻（幂等只记第一次——空回合重试与
      // 多轮工具循环都不覆盖），与首个 delta 配对算出真实模型 TTFT
      runTiming?.markModelRequestSent()
      response = await deps.createMessage(
        { messages: sanitizeHistoryForModel(messages), tools: modelTools, signal: modelAbort.signal },
          (delta) => {
            // B 部分埋点：首个模型 delta（reasoning 或 content）到达的时刻
            runTiming?.markModelByte()
            if (delta.reasoning) {
              reasoningSeen = true
              emit({ type: 'reasoning', delta: delta.reasoning })
            }
          },
        )
      } catch (err) {
        runCost.recordModelCall(null)
        throw err
      } finally {
        watcher?.stop()
      }

      runCost.recordModelCall(response)

      // §0 model_info：每回合第一次模型调用结束后发一次（reasoning=该次调用
      // 是否收到过任何思考增量；不落库，前端据此提示"不公开思考过程"）
      if (!modelInfoEmitted) {
        modelInfoEmitted = true
        const info = describePlanAgentModel(response)
        emit({ type: 'model_info', providerName: info.providerName, model: info.model, reasoning: reasoningSeen })
      }

      // DeepSeek 推理模型响应带 reasoning_content，回传历史与落库前只保留协议字段
      const assistantParam = {
        role: 'assistant' as const,
        content: response.content ?? null,
        ...(response.tool_calls?.length ? { tool_calls: response.tool_calls } : {}),
      }

      const toolCalls = response.tool_calls ?? []
      const hasAskUser = toolCalls.some((call) => call.type === 'function' && call.function.name === 'ask_user')
      if (
        !hasAskUser &&
        typeof response.content === 'string' &&
        looksLikeUnansweredUserQuestion(response.content)
      ) {
        // 扣下违规正文：仅进内存消息（供重试上下文），不发 text 事件、不落库、
        // 不执行同响应里的任何工具调用。压入的副本不带 tool_calls——工具未
        // 执行，历史里留了调用记录就会成为"无回执的悬空 tool_calls"，下一次
        // 模型请求会被 DeepSeek 以 400 拒掉（2026-09-02 预览实测踩坑）
        messages.push({ role: 'assistant', content: response.content })
        if (!questionGuardRetried) {
          questionGuardRetried = true
          messages.push({ role: 'user', content: PROTOCOL_RETRY_INSTRUCTION })
          continue
        }
        emit({ type: 'error', message: PROTOCOL_ERROR_MESSAGE })
        break
      }

      // 空回合守卫：正文为空且无任何工具调用，是推理模型把输出预算全数耗在
      // reasoning 上的典型形态（finish_reason=length，见 emptyTurn.ts）。放在
      // ask_user 协议守卫之后、落库之前：空 assistant 不落库、不发 text 事件；
      // 第一次注入纠正指令（只进内存消息）重试一次，仍为空则报可恢复错误并
      // 结束——绝不把空回合当正常结束写进历史，让用户面对无输出的沉默。
      const isEmptyTurn =
        toolCalls.length === 0 && (typeof response.content !== 'string' || !response.content.trim())
      if (isEmptyTurn) {
        if (!emptyTurnRetried) {
          emptyTurnRetried = true
          emit({ type: 'status', phase: '模型上一轮没有产出内容，正在让它精简思考重试' })
          messages.push({ role: 'user', content: EMPTY_TURN_RETRY_INSTRUCTION })
          continue
        }
        emit({ type: 'error', message: EMPTY_TURN_ERROR_MESSAGE })
        break
      }

      if (typeof response.content === 'string' && response.content) {
        emit({ type: 'text', text: response.content })
      }
      messages.push(assistantParam as ChatMessageParam)
      await runRepo.appendMessage(deps.planId, 'assistant', assistantParam as unknown as Prisma.JsonValue)

      if (!toolCalls.length) break

      for (const call of toolCalls) {
        if (call.type !== 'function') continue
        let input: unknown = {}
        let malformedArgs = false
        try {
          input = JSON.parse(call.function.arguments || '{}')
        } catch {
          malformedArgs = true
        }
        const argsSummary = summarizeToolArgs(call.function.name, input, locale)
        // status/tool_call 事件只发 SSE，是瞬时遥测，绝不写进 TripPlanMessage
        emit({ type: 'status', phase: toolStatusPhrase(call.function.name, input, locale) })
        emit({ type: 'tool_call', id: call.id, name: call.function.name, argsSummary, status: 'running' })
        const startedAt = Date.now()
        let result: string
        try {
          if (malformedArgs) {
            // 参数本身不是合法 JSON（典型成因：超长 tool call 被模型输出长度
            // 截断）。旧实现把解析失败静默降级成 {} 喂给工具，save_plan_days
            // 会报出误导性的"days 必须是数组"，诱导模型原样重发巨量参数。
            // 必须显式告知参数已损坏，让模型重新生成（必要时精简内容）。
            result = JSON.stringify({
              error:
                '工具调用参数不是合法 JSON（可能被模型输出长度截断）。请重新生成完整、合法的参数；若因内容过长被截断，请精简条目文字后重试，不要原样重发。',
            })
          } else {
            // 第九轮 L1：工具执行前续租——同轮多次连续工具调用期间租约不会
            // 到期；被接管（续租被拒）时 RunFencedError 冒泡，按现有语义静默收尾
            await deps.renewLease?.()
            result = await executePlanTool(toolDeps, call.function.name, input)
          }
        } catch (err) {
          if (!(err instanceof AskUserSignal)) throw err
          // ask_user 是"第三种路径"：既不是正常 break，也不是 RunFencedError 静默，
          // 更不是真错误。落库 ask payload（走栅栏保护的 runRepo；若此刻已被新
          // 请求接管，appendMessage 抛 RunFencedError 冒泡到外层 catch 静默收尾，
          // 语义与其它工具写入被栅栏拦下完全一致），再补一条 tool 回执——让带
          // tool_calls 的 assistant 消息在下一轮回放时成组保留（ask 行没有
          // role 字段，isChatMessage 过滤后与紧邻的回执仍然相邻），然后发 ask
          // 事件、提前进入与正常结束一致的收尾流程（done 事件 + 外层
          // endAgentRun），不再发起下一次模型调用。
          emit({
            type: 'tool_call',
            id: call.id,
            name: call.function.name,
            argsSummary,
            status: 'done',
            durationMs: Date.now() - startedAt,
            resultSummary: '等待用户回答',
          })
          toolCallSummaries.push({ name: call.function.name, durationMs: Date.now() - startedAt })
          await runRepo.appendMessage(deps.planId, 'ask', err.payload as unknown as Prisma.JsonValue)
          await runRepo.appendMessage(deps.planId, 'tool', {
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'asked',
              askId: err.payload.askId,
              note: serverText(locale).askUserNote,
            }),
          } as unknown as Prisma.JsonValue)
          emit({ type: 'ask', ...err.payload })
          break outer
        }
        emit({
          type: 'tool_call',
          id: call.id,
          name: call.function.name,
          argsSummary,
          status: 'done',
          durationMs: Date.now() - startedAt,
          resultSummary: summarizeToolResult(call.function.name, result, locale),
        })
        toolCallSummaries.push({ name: call.function.name, durationMs: Date.now() - startedAt })
        const toolParam: ChatMessageParam = { role: 'tool', tool_call_id: call.id, content: result }
        messages.push(toolParam)
        await runRepo.appendMessage(deps.planId, 'tool', toolParam as unknown as Prisma.JsonValue)
      }

      // 单次上限（§6.2/G7）：在本轮全部工具回执之后检查（合同见 runCost.ts）
      const cap = runCost.checkCap(iteration)
      if (cap.systemNote !== undefined) messages.push({ role: 'user', content: cap.systemNote })
    }
  } catch (err) {
    if (err instanceof RunFencedError || isUserStoppedAbort(err)) {
      // A3（§0）+ H2：栅栏失败或看守 abort 既可能是"用户停止"（stopAgentRun
      // 清了 token、留下标记行/持久日志），也可能是 busy 过期被新请求接管
      // （保持既有静默收尾语义）。按停止证据区分归属：证据在 → stopped 收尾；
      // 否则 fenced
      if (await stopEvidencePresent(deps.repo, deps.planId, deps.runToken ?? null)) {
        stopped = true
      } else {
        // 已被新请求接管，静默结束——不是真正的错误，new 请求会接手对话，
        // 也不写运行日志（见上方 fenced 注释）
        fenced = true
      }
    } else {
      // 瞬时网络错误（workerd "Network connection lost." 等）按站点语言映射成
      // 友好文案，其余上游错误保留原文案（鉴权/配额等有诊断价值）
      emit({ type: 'error', message: agentErrorMessage(err, locale) })
    }
  } finally {
    // 第七轮 A1（M1/M2 修订）：实况 writer 收尾。正常结束的 run 强制 flush
    // 最后一份实况并清除该行（busy 落幕后 GET 不再返回 live）；被接管的
    // run 既不 flush 也不 clear——旧 token 落笔会覆盖新 run 的实况行，
    // 残留行由接管 run 覆盖、读侧 runToken 过滤与 GET 的顺手清理兜底。
    // 第八轮 A1：客户端断开的 run 不 flush（没人再看）但 clear——GET 才能
    // 区分「在跑」与「被打断」。
    // M1：finish 最多阻塞 2 秒——库慢时 SSE 的 done 事件不能被拖住，超时
    // 后收尾继续在后台完成（浮动 promise，失败只 warn）；writer 内部吞错，
    // 这里的 catch 只是兜底防未处理拒绝。必须先于运行日志写入完成。
    if (runLiveWriter) {
      const finishing = runLiveWriter.finish(
        interrupted || stopped ? { flush: false, clear: true } : { flush: !fenced, clear: !fenced },
      )
      await Promise.race([finishing, sleep(RUN_LIVE_FINISH_TIMEOUT_MS)])
      finishing.catch((err) => console.warn('[planAgent/runLive] 后台收尾失败（不影响对话）', err))
    }
    // 计费结算（§6.2）：settle 回调 onRunCost，返回的 summary 供下方 appendRunLog 复用
    const runCostSummary = await runCost.settle(deps.onRunCost)
    // M4 运行日志：run 结束（正常/报错）都写一条；被栅栏接管的 run 不写。
    // 写日志本身绝不能把 run 拖垮，失败只 warn。enrich/gate 取本 run 最后
    // 一次 save 的评估结果（onSaveEvaluated 捕获），没有 save 过则为 null。
    // 第八轮 A1：客户端断开的 run 写 stage=interrupted（其余字段照常），
    // GET 据此向前端暴露「上次被打断、可自动续跑」
    if (!fenced) {
      const stoppedLogWritten = stopped && (await stoppedLogExists(deps.repo, deps.planId, deps.runToken ?? null))
      if (stoppedLogWritten) {
        await runCost.writeStoppedLogUsage(deps.repo, deps.planId, deps.runToken ?? null)
      } else {
        try {
          await deps.repo.appendRunLog({
            planId: deps.planId,
            runToken: deps.runToken ?? null,
            turnIndex,
            stage: stopped ? 'stopped' : interrupted ? 'interrupted' : stage,
            enrichReport: (saveEvaluation.current?.enrich ?? null) as Prisma.JsonValue | null,
            gateReport: (saveEvaluation.current?.quality ?? null) as Prisma.JsonValue | null,
            toolCalls: toolCallSummaries as unknown as Prisma.JsonValue,
            modelUsage: runCostSummary as unknown as Prisma.JsonValue,
            durationMs: Date.now() - runStartedAt,
          })
        } catch (err) {
          console.warn('[planAgent] appendRunLog failed', err)
        }
      }
      // R4 补齐续跑（S3/S10 修订）：只在最后一次保存**通过门控**且仍有
      // 「预算已用完」类 skipped 或 restaurantPending 条目时派发——先只看
      // 评估报告，无需续跑直接跳过，不做 getPlan 往返；门控未过的保存在
      // 上面已被拒绝落库（整改单是模型的活），补齐脚本不该再碰这份计划
      // A3：用户停止的 run 不派发（§0：停止后不自动续跑）；§0.5 软截止/
      // 客户端断开收尾的 run 同样不派发（interrupted 回合交给用户侧续跑）
      try {
        const evaluation = saveEvaluation.current
        if (!stopped && !interrupted && evaluation?.quality.passed && planNeedsContinuation(evaluation.enrich)) {
          const planAfterRun = await deps.repo.getPlan(deps.planId)
          if (planAfterRun && planNeedsContinuation(evaluation.enrich, planAfterRun.days)) {
            const task = () =>
              runEnrichContinuation({
                planId: deps.planId,
                runToken: deps.runToken ?? null,
                repo: deps.repo,
                points: deps.toolDeps.points,
                deps: {
                  places: deps.toolDeps.places,
                  externalPlaces: deps.toolDeps.externalPlaces,
                  fetchPlacePhotos: deps.toolDeps.fetchPlacePhotos,
                  findRestaurants: deps.toolDeps.findRestaurants,
                  travel: deps.toolDeps.travel,
                },
                // G8：续跑补齐同样受档位约束，真实外呼成本经 onExtraCost 入账
                ...(deps.entitlements ? { entitlements: deps.entitlements } : {}),
                ...(deps.onExtraCost ? { onExtraCost: deps.onExtraCost } : {}),
              })
            // S1：route 不注入时缺省走 serverDeps 的 runInBackground——生产
            // （Cloudflare）用它挂 ctx.waitUntil，续跑的 61s sleep 才不会随
            // 响应结束的隔离体一起被销毁；本地无绑定时退化为浮动 promise
            ;(deps.runInBackground ?? runInBackground)(task)
          }
        }
      } catch (err) {
        console.warn('[planAgent] enrich continuation dispatch failed', err)
      }
    }
  }

  // 第八轮 A1：客户端断开时 SSE 已关闭，不再发 done（正常/报错收尾照发）
  // A3（§0）：停止收尾先发 stopped 再发 done
  if (stopped) emit({ type: 'stopped' })
  if (!interrupted) emit({ type: 'done' })
  // 第九轮 A2/A4：收尾合并器（刷出残余缓冲、取消定时器），然后打 run summary
  eventCoalescer.dispose()
  console.log('[agent] run summary', {
    planId: deps.planId,
    turnIndex,
    durationMs: Date.now() - runStartedAt,
    events: emittedEvents,
    reasoningChars,
    toolCalls: toolCallSummaries.length,
    modelCalls: runCost.modelCalls,
  })
}
