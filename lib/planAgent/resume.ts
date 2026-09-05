import type { TripPlanMessage, TripPlanRunLogRecord } from '@/lib/tripPlan/repo'

/**
 * 第八轮 §0：resume 回合注入本回合 [系统状态] 的中断说明（仅内存 messages，
 * 不落库）——模型基于已保存的进度继续，不重复已完成的工具调用。
 * 第九轮 A4：补平台终止场景的指引——上次中断没有任何收尾（缺运行日志）
 * 说明 isolate 被 CPU 上限硬杀，模型已产出的工具结果可能还没落库。
 * 第九轮 L2：已落库的工具结果就在历史消息里，直接复用，不要重新查询
 * 同样的路线或餐厅（浪费外呼预算与用户等待时间）。
 */
export const RESUME_NOTE =
  '上一回合因连接中断被打断，请基于已保存的消息与行程继续，不要重复已经完成的工具调用；已落库的工具结果都在历史消息里，直接基于它们继续，不要重新查询同样的路线或餐厅。如果行程已保存完整，直接给出总结。若上次中断没有任何收尾，说明是平台终止，请优先把已完成的工具结果落库（save_plan_days），再继续未完成部分。'

/** 第八轮 F1：中断推断的依据（前端可忽略，供排查与测试断言） */
export type InterruptedReason = 'run_log' | 'missing_run_log' | 'dangling'

export type InterruptedInference = {
  /** 最后一条消息的 createdAt */
  at: Date
  /** 该被打断回合的序号 = (最后一条运行日志的 turnIndex ?? 0) + 1 */
  turnIndex: number
  reason: InterruptedReason
}

/**
 * 第十一轮 A3（§0）：最后一条运行日志是用户停止（stage='stopped'）且写于
 * 最后一条 human 消息之后——该回合是"用户主动停笔"，不是被打断：
 * inferInterrupted 对此返回 null（前端不自动续跑），canResume 仍返回 true
 * （用户手动 { resume: true } 可续）。
 */
function stopIsFinalTail(messages: TripPlanMessage[], runLogs: TripPlanRunLogRecord[]): boolean {
  const lastLog = runLogs.length ? runLogs[runLogs.length - 1]! : null
  if (!lastLog || lastLog.stage !== 'stopped') return false
  const lastHuman = [...messages].reverse().find((m) => m.kind === 'human') ?? null
  if (!lastHuman) return true
  return lastLog.createdAt.getTime() > lastHuman.createdAt.getTime()
}

/**
 * 第八轮 F1：从持久化状态推断「上一次 run 被打断」。调用前提 agentBusy=false；
 * 三条按优先级取第一个命中的作为 reason：
 * 1. run_log——最后一条运行日志 stage=interrupted（loop 的 finally 正常执行、
 *    写下了中断日志）；
 * 2. missing_run_log——最后一条 human 消息之后没有任何运行日志（isolate 被
 *    平台硬杀，finally 没执行、日志写不到；本轮已产出过的 assistant 文本与
 *    工具回执照常落库，但回合永远收不了尾）；
 * 3. dangling——该回合有正常日志，但最后一条非 tool/daymap 消息是带
 *    tool_calls 的 assistant（run 中途报错收尾，对话悬空在工具调用半途）。
 *    未回答的 ask 不算 dangling：ask 回合的 finally 日志必然已写（stage 非
 *    interrupted），那是「设计上的停笔等回答」而非被打断——把它算上会让
 *    前端在每次挂载时对等待回答的计划自动续跑；硬杀在 ask 收尾前的形态由
 *    第 2 条捕获。
 * A3 修订：stage='stopped' 的尾部日志（晚于最后 human）不是打断，直接 null。
 */
export function inferInterrupted(
  messages: TripPlanMessage[],
  runLogs: TripPlanRunLogRecord[],
): InterruptedInference | null {
  if (stopIsFinalTail(messages, runLogs)) return null
  const lastMessage = messages.length ? messages[messages.length - 1]! : null
  if (!lastMessage) return null
  const lastLog = runLogs.length ? runLogs[runLogs.length - 1]! : null

  let reason: InterruptedReason | null = null
  if (lastLog?.stage === 'interrupted') {
    reason = 'run_log'
  } else {
    const lastHuman = [...messages].reverse().find((m) => m.kind === 'human') ?? null
    if (lastHuman && lastHuman.createdAt.getTime() > (lastLog?.createdAt.getTime() ?? 0)) {
      reason = 'missing_run_log'
    } else {
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]!
        if (message.kind === 'tool' || message.kind === 'daymap') continue
        if (message.kind === 'assistant') {
          const content = message.content as { tool_calls?: unknown } | null
          if (Array.isArray(content?.tool_calls) && content.tool_calls.length > 0) {
            reason = 'dangling'
          }
        }
        break
      }
    }
  }
  if (!reason) return null
  return { at: lastMessage.createdAt, turnIndex: (lastLog?.turnIndex ?? 0) + 1, reason }
}

/**
 * 第八轮 §0 / F2：对话是否值得起一个 resume 回合——与 F1 的中断推断
 * （inferInterrupted）完全对齐，三条任一成立即可续。尾部 assistant 纯文本
 * 但该回合无运行日志 → missing_run_log 可续（RESUME_NOTE 已要求「若行程
 * 已保存完整则直接总结」，不会重复动作）；尾部 assistant 纯文本且有正常
 * 日志 → 自然收尾，nothing_to_resume。
 */
export function canResume(messages: TripPlanMessage[], runLogs: TripPlanRunLogRecord[]): boolean {
  if (inferInterrupted(messages, runLogs)) return true
  // A3（§0）：用户停止的回合不算"被打断"（不自动续跑），但手动 resume 允许
  return stopIsFinalTail(messages, runLogs)
}
