import { NextResponse } from 'next/server'
import { TRIP_PLAN_STATUSES, type TripPlanStatus, type TripPlanWithDays } from '@/lib/tripPlan/repo'
import { toChatView, toPlanView } from '@/lib/tripPlan/view'
import { inferInterrupted } from '@/lib/planAgent/resume'
import { RUN_STOP_MARKER } from '@/lib/planAgent/stop'
import type { TripPlanHandlerDeps } from './plans'

type AuthorizeResult = { error: NextResponse } | { plan: TripPlanWithDays; userId: string }

/** H2：停止标记行的保鲜期——期间并发 GET 不得顺手清掉（loop 收尾还要读它） */
const STOP_MARKER_GRACE_MS = 5 * 60 * 1000

export function createPlanByIdHandlers(deps: TripPlanHandlerDeps) {
  async function authorize(planId: string): Promise<AuthorizeResult> {
    const session = await deps.getSession()
    const userId = session?.user?.id
    if (!userId) return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) }
    const plan = await deps.repo.getPlan(planId)
    if (!plan) return { error: NextResponse.json({ error: '计划不存在' }, { status: 404 }) }
    if (plan.userId !== userId) return { error: NextResponse.json({ error: '无权访问' }, { status: 403 }) }
    return { plan, userId }
  }

  return {
    async GET(planId: string) {
      const auth = await authorize(planId)
      if ('error' in auth) return auth.error
      const messages = await deps.repo.listMessages(planId)
      const chat = toChatView(messages)
      // A4：暴露 agent 运行状态——前端断线/刷新后据此进入轮询恢复而不是误判已完成
      const agentBusy = await deps.repo.isAgentBusy(planId)
      // 第七轮 A1：busy 时附带运行实况；行上的 runToken 必须仍是当前持有者
      // （过期 run 的残留行不算数），否则视为没有实况。L5：runToken 只用于
      // 服务端匹配，不再回传——前端不依赖它
      let live: {
        reasoning: string
        statusText: string | null
        toolCalls: unknown
        updatedAt: string
      } | null = null
      if (agentBusy) {
        const row = await deps.repo.getRunLive(planId)
        if (row && row.runToken === auth.plan.agentRunToken) {
          live = {
            reasoning: row.reasoning,
            statusText: row.statusText,
            toolCalls: Array.isArray(row.toolCalls) ? row.toolCalls : [],
            updatedAt: row.updatedAt.toISOString(),
          }
        }
      } else {
        // L8：busy 已落幕后仍残留的实况行（fenced run 不写库、finish 超时
        // 未清等）顺手清掉——失败只 warn，不影响本次响应。H2 例外：5 分钟
        // 内的停止标记行是"用户停止"的跨隔离体证据（运行中的 loop 靠它区分
        // 停止与接管），并发 GET 不能把它清掉；超时后才视为残留照旧清理
        try {
          const row = await deps.repo.getRunLive(planId)
          const freshStopMarker =
            row !== null &&
            row.statusText === RUN_STOP_MARKER &&
            Date.now() - row.updatedAt.getTime() < STOP_MARKER_GRACE_MS
          if (row && !freshStopMarker) {
            await deps.repo.clearRunLive(planId)
          }
        } catch (err) {
          console.warn('[tripPlan/planById] 清理残留运行实况失败', err)
        }
      }
      // 第七轮 A2（M3 修订）：chat 修订号 = 消息数 × 1e14 + 最后一条消息的
      // createdAt 毫秒（空对话为 0）——同毫秒多条消息时纯时间戳不再推进，
      // 消息数位保证单调；前端据此判断是否需要整体替换本地消息列表
      const lastMessage = messages.length ? messages[messages.length - 1]! : null
      const chatRevision = lastMessage
        ? messages.length * 1e14 + lastMessage.createdAt.getTime()
        : 0
      // 第八轮 §0/A2 + F1：上一次 run 是否被打断——不再只信 finally 写下的
      // stage=interrupted 日志（isolate 被硬杀时 finally 不执行、日志写不到），
      // 改为从持久化状态推断（共享 lib/planAgent/resume 的 inferInterrupted，
      // 与 resume 分支的 canResume 完全对齐）。agentBusy=false 时才判定；
      // reason 供排查，前端可忽略
      let interrupted: { at: string; turnIndex: number; reason: 'run_log' | 'missing_run_log' | 'dangling' } | null =
        null
      if (!agentBusy) {
        const runLogs = await deps.repo.listRunLogs(planId)
        const inferred = inferInterrupted(messages, runLogs)
        if (inferred) {
          interrupted = {
            at: inferred.at.toISOString(),
            turnIndex: inferred.turnIndex,
            reason: inferred.reason,
          }
        }
      }
      return NextResponse.json({
        plan: toPlanView(auth.plan),
        chat,
        agentBusy,
        chatRevision,
        interrupted,
        ...(live ? { live } : {}),
      })
    },

    async PATCH(planId: string, req: Request) {
      const auth = await authorize(planId)
      if ('error' in auth) return auth.error

      let body: { title?: unknown; status?: unknown }
      try {
        body = (await req.json()) as { title?: unknown; status?: unknown }
      } catch {
        return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
      }

      const patch: { title?: string; status?: TripPlanStatus } = {}
      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || !body.title.trim()) {
          return NextResponse.json({ error: '标题不能为空' }, { status: 400 })
        }
        patch.title = body.title.trim().slice(0, 80)
      }
      if (body.status !== undefined) {
        if (typeof body.status !== 'string' || !TRIP_PLAN_STATUSES.includes(body.status as TripPlanStatus)) {
          return NextResponse.json({ error: '非法状态' }, { status: 400 })
        }
        patch.status = body.status as TripPlanStatus
      }

      await deps.repo.updateMeta(planId, patch)
      const plan = await deps.repo.getPlan(planId)
      return NextResponse.json({ plan: plan ? toPlanView(plan) : null })
    },
  }
}
