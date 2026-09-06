import type { Prisma } from '@prisma/client'
import type { EnrichBudget } from './enrich/types'
import type { PlanAgentChatMessage } from './loop'
import { describePlanAgentModel } from './api'
import { llmUsageOf, type LlmUsage, addUsage } from '@/lib/llm/usage'
import { EMPTY_GOOGLE_CALLS, summarizeRunCost, type RunCostSummary } from '@/lib/billing/cost'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'

/** 计量/结算相关的 deps 切片（设计 §6.2/G8），从 PlanAgentDeps 切出随本文件维护 */
export type RunCostDeps = {
  /** 单 run 成本上限（微美元，设计 §6.2）；达到后最多再允许两次模型调用用于保存收尾 */
  runCapMicros?: number
  /** run 结束（含报错/停止/接管）回调一次：成本汇总与是否产生过模型输出（route 用它结算） */
  onRunCost?: (summary: RunCostSummary, hadModelOutput: boolean) => Promise<void>
  /** 补齐续跑的额外 Google 成本回调（G8：route 注入 billing.chargeExtra） */
  onExtraCost?: (micros: number) => Promise<void>
}

/**
 * 单次上限触发后注入的系统状态文案。G7：这条 user 消息必须排在
 * assistant(tool_calls) → tool 之后（调用方在全部工具回执之后才 checkCap），
 * 模型下一轮才能同时看到工具结果与预算通知。
 */
const RUN_CAP_SYSTEM_NOTE =
  '[系统状态]\n本回合可用预算已用完：不要再发起任何外部查询，立即用 save_plan_days 保存当前进度并向用户简短说明，然后结束本轮。'

export type RunCostCapState = {
  capReached: boolean
  /** 只在本次调用触发上限时给出；调用方据此向模型注入 [系统状态] user 消息 */
  systemNote?: string
  /** 当前生效的迭代上限（触发后 = min(maxIterations, iteration + 3)，只留保存收尾的两轮） */
  iterationLimit: number
}

export type RunCostTracker = {
  /**
   * F4：每次模型调用记账。response=null 表示调用抛错——同样计一次
   * modelCalls 并置 usageMissing（成本口径不能只统计成功返回的调用）；
   * 正常返回但没挂 usage 的调用同样置 usageMissing。
   */
  recordModelCall(response: PlanAgentChatMessage | null): void
  /**
   * 单次上限检查（设计 §6.2）：累计成本 ≥ runCapMicros 时置位 capReached、把
   * enrichBudget 的 places/directions 上限压到 used（关掉新的 Google 外呼）、
   * 迭代上限收到 iteration+3，并返回系统状态文案。已触发或未设上限时只回读
   * 状态，绝不重复注入。G7：调用方须在本轮全部工具回执之后调用。
   */
  checkCap(iteration: number): RunCostCapState
  /**
   * 计费结算（设计 §6.2）：回调一次 onRunCost（吞错只 warn，绝不拖垮 run 收尾），
   * 返回与 appendRunLog 落库复用的同一份 summary，避免算两遍。
   */
  settle(onRunCost: RunCostDeps['onRunCost']): Promise<RunCostSummary>
  /** 最终口径：一次模型调用都没有的 run 同样标 usageMissing（与 appendRunLog 一致） */
  summary(): RunCostSummary
  /** H2/F2：用户停止且已有持久 stopped 日志时，把成本写进那条日志（不重复 append） */
  writeStoppedLogUsage(repo: TripPlanRepo, planId: string, runToken: string | null): Promise<void>
  readonly modelCalls: number
  readonly iterationLimit: number
}

export function createRunCostTracker(input: {
  enrichBudget: EnrichBudget
  runCapMicros?: number
  maxIterations: number
  withTitle: boolean
}): RunCostTracker {
  // 计量层（设计 §7）：按模型累加 usage；缺 usage 的调用记 usageMissing
  const usageByModel = new Map<string, LlmUsage>()
  let modelCalls = 0
  let usageMissing = false
  let capReached = false
  let iterationLimit = input.maxIterations

  const buildSummary = (final: boolean): RunCostSummary =>
    summarizeRunCost({
      usageByModel,
      calls: input.enrichBudget.calls ?? { ...EMPTY_GOOGLE_CALLS },
      modelCalls,
      usageMissing: final ? usageMissing || modelCalls === 0 : usageMissing,
      withTitle: input.withTitle,
    })

  return {
    recordModelCall(response) {
      modelCalls += 1
      if (!response) {
        usageMissing = true
        return
      }
      const callUsage = llmUsageOf(response)
      if (callUsage) {
        const modelName = describePlanAgentModel(response).model
        usageByModel.set(
          modelName,
          addUsage(usageByModel.get(modelName) ?? { inputMiss: 0, inputCacheHit: 0, output: 0, reasoning: 0 }, callUsage),
        )
      } else {
        usageMissing = true
      }
    },
    checkCap(iteration) {
      if (input.runCapMicros === undefined || capReached) return { capReached, iterationLimit }
      if (buildSummary(false).costMicros.total < input.runCapMicros) return { capReached, iterationLimit }
      capReached = true
      iterationLimit = Math.min(input.maxIterations, iteration + 3)
      input.enrichBudget.places.max = input.enrichBudget.places.used
      input.enrichBudget.directions.max = input.enrichBudget.directions.used
      return { capReached, systemNote: RUN_CAP_SYSTEM_NOTE, iterationLimit }
    },
    async settle(onRunCost) {
      const summary = buildSummary(true)
      if (onRunCost) {
        try {
          await onRunCost(summary, modelCalls > 0)
        } catch (err) {
          console.warn('[planAgent] onRunCost failed', err)
        }
      }
      return summary
    },
    summary() {
      return buildSummary(true)
    },
    async writeStoppedLogUsage(repo, planId, runToken) {
      try {
        await repo.updateRunLogModelUsage(planId, runToken, buildSummary(true) as unknown as Prisma.JsonValue)
      } catch (err) {
        console.warn('[planAgent] updateRunLogModelUsage failed', err)
      }
    },
    get modelCalls() {
      return modelCalls
    },
    get iterationLimit() {
      return iterationLimit
    },
  }
}
