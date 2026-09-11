import type { Prisma } from '@prisma/client'
import type OpenAI from 'openai'
import { parseDaymapPayload } from '@/lib/tripPlan/view'
import { buildStageContext, derivePlanStage, type PlanStage } from './stage'
import { createStartupStatusEmitter, type StartupStatusPhase } from './startupStatus'
import type { PlanAgentEvent } from './loop'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { TripPlanMessage, TripPlanRepo } from '@/lib/tripPlan/repo'

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

/**
 * 修复损坏的历史再回放：带 tool_calls 的 assistant 消息必须紧跟全部对应的
 * tool 回执，否则 OpenAI 协议回放会被拒。崩溃或历史并发交错会留下悬空
 * tool_calls / 孤儿 tool 回执——不清理的话该计划的后续对话会永久报错。
 *
 * 2026-09-11 D 部分：从 loop.ts 原样搬出（loop.ts 贴着 750 行预算，CUT-7
 * 需要腾位）——逻辑零改动，仅换文件；loop.ts 保留同名 re-export 供既有
 * 测试（loop.messagesGolden / loop.test）继续从 loop 导入。
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

/** run 启动段前奏的产物（见 runStartupPrelude） */
export type StartupPreludeResult = {
  /** 含本轮 human 消息（未落库时刚追加）的持久化历史——阶段推断与回放共用 */
  stageHistory: TripPlanMessage[]
  stage: PlanStage
  stageContext: string
  /** CUT-6：待首次模型请求发出后再后台回写的阶段缓存值 */
  pendingStageWrite: PlanStage | null
  /** 启动 status 发送器（active=false 时为 no-op）；loop 稍后原地发 organize */
  emitStartup: (phase: StartupStatusPhase) => void
}

/**
 * run 启动段前奏：单次读取（busy 位归属 + 历史 + 阶段推断输入）→
 * （必要时）追加本轮 human 消息 → M4 阶段推断。
 *
 * 2026-09-11 D 部分：从 loop.ts 原样搬出，把 loop 闭包里的 deps/emit/locale
 * 换成显式参数（不做模块级状态）。P2-B（同日）：前奏三读合并为一次
 * getStartupRead（1 条 SQL），语义差异见函数内注释（仅吞错一处）。
 */
export async function runStartupPrelude(deps: {
  repo: TripPlanRepo
  planId: string
  runToken?: string
  userMessage: string
  userMessagePersisted?: boolean
  emit: (event: PlanAgentEvent) => void
  locale: SupportedLocale
}): Promise<StartupPreludeResult> {
  // P2-B（2026-09-11）：前奏三读（isAgentRunStopped + listMessages +
  // getStageInputs，3 次串行 DB 往返 ≈ 0.5s）合并为一次 getStartupRead
  // （1 条 SQL）。语义差异仅一处：旧 isAgentRunStopped 读失败时吞错、
  // holdsRun=true；新单读失败直接抛——与旧 listMessages 的抛错一致（历史
  // 读失败本来就是致命的）。read=null（计划已删）与旧行为对齐：history=[]、
  // stageInputs=null、holdsRun=false（token 不匹配）。
  const read = await deps.repo.getStartupRead(deps.planId)
  // 2026-09-10 首帧优化：先确认仍持有 busy 位——被接管（队列滞留后启动）的
  // run 不发也不落库，旧 token 落笔会覆盖新 run 的实况行（runLive M2 语义）
  const holdsRun = deps.runToken ? read !== null && read.agentRunToken === deps.runToken : true
  const emitStartup = createStartupStatusEmitter(deps.emit, deps.locale, holdsRun)

  // 两条启动 status 的相对顺序与发射点保持：readHistory →（必要时追加本轮
  // human 消息）→ checkProgress → 推断。
  emitStartup('readHistory')
  // 评审修正 3（2026-09-11）：这一拍微任务是必需的，不是装饰。runLive writer
  // 的 queueFlush 用 flushQueued 去重——同一微任务里紧跟着发出的
  // checkProgress 会被并进同一次 upsert（statusText 取最新一条），实况行上
  // 「正在读取对话历史」永远不落库，刷新恢复的客户端就看不到这一步。
  // P2-B 之前两条 status 之间天然隔着 listMessages 的 DB 往返；三读合一后
  // 读没法再挪到两条之间——holdsRun 闸门必须先拿到 agentRunToken 才能决定
  // 发不发（被接管的旧 run 一条 status 也不许发、不许落库，见上面的注释），
  // 所以读只能在前，这里自己让出一拍把排队的 flush 交出去。代价是一个微任务
  // （不是 setTimeout），换回 readHistory / checkProgress 两次独立落库。
  await Promise.resolve()
  const history = read?.messages ?? []

  const userParam: ChatMessageParam = { role: 'user', content: deps.userMessage }
  // 阶段推断需要包含"本轮这条 human 消息"的完整历史（revise 判定依赖它）
  let stageHistory = history
  if (!deps.userMessagePersisted) {
    const appended = await deps.repo.appendMessage(deps.planId, 'human', userParam as unknown as Prisma.JsonValue)
    stageHistory = [...history, appended]
  }

  // M4 阶段推断：从持久化证据（计划结构 + 最近 daymap 的 quality + 消息历史）
  // 推断当前阶段并注入本轮消息。CUT-3：改用 getStageInputs 轻量投影（单条
  // SQL 的 EXISTS 子查询），不再为推断拉整棵 PLAN_INCLUDE；TripPlan.stage 只
  // 是缓存。CUT-6：缓存回写不再阻塞关键路径——推断完只记待写值，等首次
  // 模型请求确实发出后再后台派发（loop.ts 的 afterModelRequestIssued）
  emitStartup('checkProgress')
  let stage: PlanStage = 'works'
  let stageContext = ''
  let pendingStageWrite: PlanStage | null = null
  const stageInputs = read?.stageInputs ?? null
  if (stageInputs) {
    const lastDaymap = [...stageHistory].reverse().find((m) => m.kind === 'daymap')
    const quality = lastDaymap ? parseDaymapPayload(lastDaymap.content)?.quality ?? null : null
    stage = derivePlanStage({ plan: stageInputs, messages: stageHistory, quality })
    stageContext = buildStageContext(stage, quality)
    pendingStageWrite = stage
  }
  return { stageHistory, stage, stageContext, pendingStageWrite, emitStartup }
}
