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
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

export type PlanAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'plan_updated' }
  | { type: 'done' }
  | { type: 'error'; message: string }
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
}

/**
 * 把 repo 的写方法（appendMessage/replaceDays/updateMeta）替换成 token 校验
 * 过的原子版本；校验失败时抛 RunFencedError 而不是静默返回，因为调用点
 * 分散在循环主体和 tools.ts 的工具执行器里，抛异常是唯一能统一从任意调用
 * 深度冒泡回循环顶层的方式。其余方法原样透传（绑定回 target 以保证内部
 * this 正确，与 lib/db/prisma.ts 的 Proxy 用法一致）。
 */
function withFencing(repo: TripPlanRepo, token: string): TripPlanRepo {
  const fenced: Pick<TripPlanRepo, 'appendMessage' | 'replaceDays' | 'updateMeta' | 'replaceDaysWithDaymap'> = {
    async appendMessage(planId, kind, content) {
      const result = await repo.appendMessageIfActive(planId, token, kind, content)
      if (!result) throw new RunFencedError()
      return result
    },
    async replaceDays(planId, days) {
      const result = await repo.replaceDaysIfActive(planId, token, days)
      if (!result) throw new RunFencedError()
      return result
    },
    async updateMeta(planId, patch) {
      const result = await repo.updateMetaIfActive(planId, token, patch)
      if (!result) throw new RunFencedError()
      return result
    },
    async replaceDaysWithDaymap(planId, days, buildDaymapContent) {
      // "替换天数 + 追加 daymap"在 repo 侧已是同一原子窗口；栅栏在窗口外
      // 拦截时两写都不发生，不会出现"天数换了、交付物消息丢了"的半截态
      const result = await repo.replaceDaysWithDaymapIfActive(planId, token, days, buildDaymapContent)
      if (!result) throw new RunFencedError()
      return result
    },
  }
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop in fenced) return fenced[prop as keyof typeof fenced]
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const DEFAULT_MAX_ITERATIONS = 12

function isChatMessage(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'role' in value
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
  // 不进 sanitizeChatHistory 的输入——它只处理持久化历史）
  const messages: ChatMessageParam[] = [
    {
      role: 'system',
      content: PLAN_AGENT_SYSTEM_PROMPT,
    },
    ...sanitizeChatHistory(
      stageHistory
        .map((m) => m.content)
        .filter(isChatMessage)
        .map((m) => m as unknown as ChatMessageParam),
    ),
  ]
  if (stageContext) {
    // N5：不再单独插入 [系统状态] user 消息（避免连续 user 消息），改为把
    // 阶段上下文拼进内存中最新 human 消息的内容前部；落库行仍是纯用户原文
    // （appendMessage 写的是 userParam，此改写只发生在发给模型的 messages
    // 数组上；sanitizeChatHistory 的输入是持久化历史，不受影响）
    const prefix = `[系统状态]\n${stageContext}\n\n[用户消息]\n`
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
      messages.push({ role: 'user', content: `[系统状态]\n${stageContext}` })
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

  const toolDeps: PlanAgentToolDeps = {
    ...deps.toolDeps,
    repo: runRepo,
    // Google 补齐预算每个 run 创建一次：同一 run 内多次 save 共享同一份
    // directions/places 配额，避免每次 save 重置预算重烧 Google 调用
    enrichBudget: deps.toolDeps.enrichBudget ?? createEnrichBudget(),
    onPlanUpdated: () => {
      deps.toolDeps.onPlanUpdated?.()
      onEvent({ type: 'plan_updated' })
    },
    onDaymapSaved: (daymap) => {
      deps.toolDeps.onDaymapSaved?.(daymap)
      onEvent(daymap)
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
  try {
    // 强制 ask_user 协议守卫（M3 修订）：只要本轮响应里没有 ask_user 调用，
    // 正文又像"向用户提问"（含"解释文字 + 其它工具调用"的组合），整条响应
    // ——正文与工具调用——都被扣下：不发 SSE、不落库、不执行工具，只进
    // 内存消息并注入纠正指令重试一次。重试干净则正常继续；再犯只发可恢复
    // 的协议错误（正文依旧扣下），绝不留下无法回答的悬空提问。
    let questionGuardRetried = false
    let emptyTurnRetried = false
    outer: for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (deps.signal?.aborted) break
      // 通用防线：无论哪条路径在内存消息里留下悬空 tool_calls（守卫扣下、
      // 信号中止、栅栏错误……），都在发给模型前补齐占位回执，绝不产出
      // "assistant 带 tool_calls 但无 tool 回执"的非法序列（DeepSeek 400）
      assertNoOrphanToolCalls(messages)
      // reasoning 增量逐帧透传给 SSE（content 增量不转发：最终答案等本轮结束后
      // 仍走下面那个完整 text 事件，这是"思考过程流式、答案整段"的产品取舍）
      const response = await deps.createMessage({ messages, tools: PLAN_AGENT_TOOLS }, (delta) => {
        if (delta.reasoning) onEvent({ type: 'reasoning', delta: delta.reasoning })
      })

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
        onEvent({ type: 'error', message: PROTOCOL_ERROR_MESSAGE })
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
          onEvent({ type: 'status', phase: '模型上一轮没有产出内容，正在让它精简思考重试' })
          messages.push({ role: 'user', content: EMPTY_TURN_RETRY_INSTRUCTION })
          continue
        }
        onEvent({ type: 'error', message: EMPTY_TURN_ERROR_MESSAGE })
        break
      }

      if (typeof response.content === 'string' && response.content) {
        onEvent({ type: 'text', text: response.content })
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
        const argsSummary = summarizeToolArgs(call.function.name, input)
        // status/tool_call 事件只发 SSE，是瞬时遥测，绝不写进 TripPlanMessage
        onEvent({ type: 'status', phase: toolStatusPhrase(call.function.name, input) })
        onEvent({ type: 'tool_call', id: call.id, name: call.function.name, argsSummary, status: 'running' })
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
          onEvent({
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
              note: '已向用户发起结构化提问，本轮对话结束，等待用户通过下一条消息回答',
            }),
          } as unknown as Prisma.JsonValue)
          onEvent({ type: 'ask', ...err.payload })
          break outer
        }
        onEvent({
          type: 'tool_call',
          id: call.id,
          name: call.function.name,
          argsSummary,
          status: 'done',
          durationMs: Date.now() - startedAt,
          resultSummary: summarizeToolResult(call.function.name, result),
        })
        toolCallSummaries.push({ name: call.function.name, durationMs: Date.now() - startedAt })
        const toolParam: ChatMessageParam = { role: 'tool', tool_call_id: call.id, content: result }
        messages.push(toolParam)
        await runRepo.appendMessage(deps.planId, 'tool', toolParam as unknown as Prisma.JsonValue)
      }
    }
  } catch (err) {
    if (err instanceof RunFencedError) {
      // 已被新请求接管，静默结束——不是真正的错误，new 请求会接手对话，
      // 也不写运行日志（见上方 fenced 注释）
      fenced = true
    } else {
      // 瞬时网络错误（workerd "Network connection lost." 等）映射成友好中文，
      // 其余上游错误保留原文案（鉴权/配额等有诊断价值）
      onEvent({ type: 'error', message: agentErrorMessage(err) })
    }
  } finally {
    // M4 运行日志：run 结束（正常/报错）都写一条；被栅栏接管的 run 不写。
    // 写日志本身绝不能把 run 拖垮，失败只 warn。enrich/gate 取本 run 最后
    // 一次 save 的评估结果（onSaveEvaluated 捕获），没有 save 过则为 null
    if (!fenced) {
      try {
        await deps.repo.appendRunLog({
          planId: deps.planId,
          runToken: deps.runToken ?? null,
          turnIndex,
          stage,
          enrichReport: (saveEvaluation.current?.enrich ?? null) as Prisma.JsonValue | null,
          gateReport: (saveEvaluation.current?.quality ?? null) as Prisma.JsonValue | null,
          toolCalls: toolCallSummaries as unknown as Prisma.JsonValue,
          modelUsage: null,
          durationMs: Date.now() - runStartedAt,
        })
      } catch (err) {
        console.warn('[planAgent] appendRunLog failed', err)
      }
      // R4 补齐续跑（S3/S10 修订）：只在最后一次保存**通过门控**且仍有
      // 「预算已用完」类 skipped 或 restaurantPending 条目时派发——先只看
      // 评估报告，无需续跑直接跳过，不做 getPlan 往返；门控未过的保存在
      // 上面已被拒绝落库（整改单是模型的活），补齐脚本不该再碰这份计划
      try {
        const evaluation = saveEvaluation.current
        if (evaluation?.quality.passed && planNeedsContinuation(evaluation.enrich)) {
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

  onEvent({ type: 'done' })
}
