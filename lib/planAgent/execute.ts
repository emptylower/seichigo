import type { SupportedLocale } from '@/lib/i18n/types'
import type { TripPlanRepo } from '@/lib/tripPlan/repo'
import { getBillingService } from '@/lib/billing/serverDeps'
import type { Entitlements } from '@/lib/billing/tiers'
import { createChatCompletion, generatePlanTitle, withModelUsageInRunLog } from './api'
import { searchBgmSubjects } from './bgm'
import { runPlanAgent, type PlanAgentEvent } from './loop'
import { agentErrorMessage } from './netErrors'
import { PrismaPointFinder } from './pointsPrisma'
import { RESUME_NOTE } from './resume'
import { RunFencedError } from './runFence'
import { getPlanAgentServerDeps } from './serverDeps'
import { maybeSetGeneratedTitle } from './title'
import type { RunTimingSeed } from './runTimings'

/**
 * busy 位 TTL（第九轮 L1）：90 秒——硬杀（isolate 直接被杀、finally 不执行）后
 * 最长 90 秒释放 busy 位，前端就能自动续跑（旧值 3 分钟等太久）。活着的 run
 * 由循环在每次模型调用前与每次工具执行前的续租保住持有权（见下方 renewLease
 * 与 loop.ts），单次慢推理或长工具（save_plan_days）期间也不会被误判过期。
 */
export const AGENT_BUSY_TTL_MS = 90 * 1000

export type ExecutePlanAgentRunInput = {
  repo: TripPlanRepo
  planId: string
  runToken: string
  locale: SupportedLocale
  /** 普通轮/答复轮的用户原文；续跑轮传 '' */
  message: string
  resume: boolean
  signal: AbortSignal
  onEvent: (event: PlanAgentEvent) => void
  busyTtlMs: number
  /** 软截止时间（epoch ms，§0.5）：内部路由传入，到点后循环按 interrupted 收尾 */
  deadlineAt?: number
  /** 计费（设计 §5/§6）：档位能力表与单次上限；缺省（内部测试）不限档位、不设上限 */
  billing?: { entitlements: Entitlements; runCapMicros: number }
  /**
   * B 部分埋点（2026-09-10）：启动链路分段计时的种子。队列路径由内部路由在
   * 入口注入（含 enqueuedAt）；SSE 内联路径缺省——在此记 consumerEnteredAt，
   * timings 省略 queueLatencyMs/enqueuedAt（不经队列，无投递延迟可测）。
   */
  timing?: RunTimingSeed
  /**
   * CUT-7（2026-09-11 D 部分）：队列路径的 runLive 启动 flush 压缩后移开关
   * （内部路由读 PLAN_AGENT_STARTUP_RUNLIVE_DEFER === '1' 后传入，默认关）。
   * 内联 SSE 路径不传，实况写库行为逐字不变。
   */
  deferStartupRunLive?: boolean
}

/**
 * 规划 run 的统一执行体（Task A1 从 POST route 纯搬运）：renewLease、
 * runPlanAgent 的 deps 组装、标题侧信道与 finally { endAgentRun }。SSE 路径
 * （浏览器直连）与队列内部路由（消费者自引用回调）都调它，保证两条路径的
 * 并发正确性语义（栅栏/租约/停止）完全一致。
 */
export async function executePlanAgentRun(input: ExecutePlanAgentRunInput): Promise<void> {
  const { repo, planId, runToken, locale, message, resume, signal, onEvent, busyTtlMs } = input

  // B 部分埋点：SSE 内联路径（route 不传 timing）在执行体入口补记消费时刻
  const timingSeed: RunTimingSeed = input.timing ?? { consumerEnteredAt: new Date().toISOString() }

  // 第九轮 L1：租约续租（token 匹配才续，被接管后自动失效）。循环在每次
  // 模型调用前与每次工具执行前调用，save_plan_days 内部还会再续两次；被
  // 接管 → 抛 RunFencedError 结束本 run（现有栅栏语义）；瞬时库错误不打断对话
  const renewLease = async (): Promise<void> => {
    const renewed = await repo.renewAgentRun(planId, runToken, busyTtlMs).catch(() => true)
    if (!renewed) throw new RunFencedError()
  }

  try {
    await Promise.all([
      runPlanAgent(
        {
          createMessage: createChatCompletion,
          repo: withModelUsageInRunLog(repo),
          planId,
          renewLease,
          toolDeps: {
            planId,
            repo,
            points: new PrismaPointFinder(),
            bgmSearch: searchBgmSubjects,
            ...getPlanAgentServerDeps(planId),
          },
          signal,
          userMessagePersisted: true,
          runToken,
          // §0.6：服务端固定文案（思维链短语/网络错误/补齐标签）的站点语言
          locale,
          // B 部分埋点：分段计时种子（SSE 兜底在上方构造）
          timingSeed,
          // CUT-7：runLive 启动 flush 压缩后移（默认关；内联 SSE 路径不传）
          ...(input.deferStartupRunLive ? { deferStartupRunLive: true } : {}),
          // 第十一轮 A3（§0）：模型流式期间的停止检查（租约看守定期
          // 轮询，发现 token 已被 stopAgentRun 清掉就 abort 模型请求）
          isStopped: () => repo.isAgentRunStopped(planId, runToken),
          // 第八轮 A3：resume 回合注入中断说明（loop 拼进本回合 [系统状态]，
          // 仅内存不落库），模型从已保存的进度继续
          ...(resume ? { resumeNote: RESUME_NOTE } : {}),
          // §0.5 软截止（内部路由传入 start + 13 min；SSE 路径不传）
          ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
          ...(input.billing ? { entitlements: input.billing.entitlements, runCapMicros: input.billing.runCapMicros } : {}),
          // 结算（设计 §6.2）：runRef 即 runToken；管理员/无预扣时 settleRun 是 no-op
          onRunCost: (summary, hadModelOutput) =>
            getBillingService().settleRun({ runRef: runToken, actualMicros: summary.costMicros.total, hadModelOutput }),
          // G8：补齐续跑的额外 Google 成本挂同一 runRef 入账
          onExtraCost: (micros) => getBillingService().chargeExtra({ runRef: runToken, micros }),
        },
        message,
        onEvent,
      ),
      // 标题侧信道：与主循环并行的一次轻量标题生成，让标题在第一轮
      // 消息后就出现（不走 run-token 栅栏，见 lib/planAgent/title.ts）。
      // resume 无新用户消息可作标题素材，跳过
      ...(message
        ? [
            maybeSetGeneratedTitle(
              {
                repo,
                planId,
                createTitle: (userMessage) => generatePlanTitle(userMessage, signal),
                onTitleUpdated: () => onEvent({ type: 'plan_updated' }),
              },
              message,
            ),
          ]
        : []),
    ])
  } catch (err) {
    // 循环 try 块之外的异常（历史读取等）与瞬时网络错误统一经
    // agentErrorMessage 映射：网络类按站点语言的友好文案，其余保留原始 message
    onEvent({ type: 'error', message: agentErrorMessage(err, locale) })
    onEvent({ type: 'done' })
  } finally {
    // 无论正常结束、报错还是客户端断开，都要释放 busy 位，
    // 否则该计划要等 TTL 过期才能继续对话
    await repo.endAgentRun(planId, runToken).catch(() => undefined)
  }
}
