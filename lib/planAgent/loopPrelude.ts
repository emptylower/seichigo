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
 * run 启动段前奏：busy 位持有确认（首帧优化的 holdsRun 闸门）→ 读取历史 →
 * （必要时）追加本轮 human 消息 → M4 阶段推断。
 *
 * 2026-09-11 D 部分：从 loop.ts 原样搬出——逻辑零改动，仅把 loop 闭包里的
 * deps/emit/locale 换成显式参数（不做模块级状态）。
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
  const emitStartup = createStartupStatusEmitter(deps.emit, deps.locale, holdsRun)

  emitStartup('readHistory')
  const history = await deps.repo.listMessages(deps.planId)

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
  const stageInputs = await deps.repo.getStageInputs(deps.planId)
  if (stageInputs) {
    const lastDaymap = [...stageHistory].reverse().find((m) => m.kind === 'daymap')
    const quality = lastDaymap ? parseDaymapPayload(lastDaymap.content)?.quality ?? null : null
    stage = derivePlanStage({ plan: stageInputs, messages: stageHistory, quality })
    stageContext = buildStageContext(stage, quality)
    pendingStageWrite = stage
  }
  return { stageHistory, stage, stageContext, pendingStageWrite, emitStartup }
}
