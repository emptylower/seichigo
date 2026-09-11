import type { CfBindingsEnv } from '@/lib/anitabi/cf/bindings'
import type { PlanAgentQueueMessage } from '@/lib/planAgent/queueMessage'

/**
 * Phase 1-A（2026-09-11 联合方案 §3）：规划 run 的派发信道选择器。
 *
 * 三条信道：DO alarm（canary 灰度）→ Cloudflare Queue（现役默认）→ 内联
 * SSE（兜底，由调用方执行）。POST 路由把原 queue.send 段整体换成 dispatchRun，
 * transport 决策集中到这一处。
 *
 * DO 接纳三分类（§3.3，严格）：
 * - accepted：响应 JSON accepted === true（含 duplicate）；
 * - rejected：响应 JSON accepted === false 且带 reason → 继续尝试队列；
 * - unknown：超时 / 抛错 / 非 JSON / 其它形状 → 不再投队列、不走内联，
 *   调用方仍返回 202（claim 一次性领取保证 DO alarm 重试只会 winner 或
 *   skipped；重复投队列会引入双通道竞态，宁可等 alarm 自带的重试）。
 */

export type DispatchOutcome =
  | { transport: 'do'; state: 'accepted' | 'unknown' }
  | { transport: 'queue'; state: 'accepted' }
  | { transport: 'none' }

/** DO stub fetch 的硬超时：接纳协议要求亚秒级返回，5 秒仍无响应按 unknown 处理 */
const DO_FETCH_TIMEOUT_MS = 5_000

const DISPATCH_DO_URL = 'https://plan-run-dispatcher/dispatch'

/**
 * 是否走 DO 派发：PLAN_AGENT_DISPATCH === 'do' 且绑定存在且 userId 在
 * PLAN_AGENT_DO_CANARY_USER_IDS（逗号分隔）白名单。白名单为空 = 没有人走
 * DO。与 PLAN_AGENT_QUEUE_ENABLED 无关：队列开关只管队列，不影响 DO 选择。
 */
export function shouldDispatchViaDo(env: CfBindingsEnv | undefined, userId: string): boolean {
  if (process.env.PLAN_AGENT_DISPATCH !== 'do') return false
  if (!env?.PLAN_RUN_DISPATCHER) return false
  const canary = (process.env.PLAN_AGENT_DO_CANARY_USER_IDS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return canary.includes(userId)
}

export async function dispatchRun(input: {
  env: CfBindingsEnv | undefined
  message: PlanAgentQueueMessage
  userId: string
}): Promise<DispatchOutcome> {
  const { env, message, userId } = input

  if (shouldDispatchViaDo(env, userId) && env?.PLAN_RUN_DISPATCHER) {
    const namespace = env.PLAN_RUN_DISPATCHER
    const stub = namespace.get(namespace.idFromName(message.runToken))
    const abort = new AbortController()
    let rejectTimedOut!: (error: Error) => void
    const timedOut = new Promise<never>((_, reject) => {
      rejectTimedOut = reject
    })
    // 单个 timer 同时喂两处：AbortController（协作型 stub 会中断请求）与
    // race（stub 不理会 signal 也必然 5s 出结果，绝不挂死 POST 请求）
    const timer = setTimeout(() => {
      abort.abort()
      rejectTimedOut(new Error(`plan run dispatcher fetch timed out after ${DO_FETCH_TIMEOUT_MS}ms`))
    }, DO_FETCH_TIMEOUT_MS)
    try {
      const res = await Promise.race([
        stub.fetch(DISPATCH_DO_URL, {
          method: 'POST',
          body: JSON.stringify(message),
          headers: { 'content-type': 'application/json' },
          signal: abort.signal,
        }),
        timedOut,
      ])
      let parsed: unknown
      try {
        parsed = JSON.parse(await Promise.race([res.text(), timedOut]))
      } catch {
        parsed = undefined
      }
      const outcome =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
      if (outcome && outcome.accepted === true) {
        return { transport: 'do', state: 'accepted' }
      }
      if (outcome && outcome.accepted === false && typeof outcome.reason === 'string') {
        // rejected：DO 明确未持久接纳 → 继续尝试队列（下方）
        console.warn('[planAgent/dispatch] DO rejected, falling back to queue', {
          runToken: message.runToken,
          reason: outcome.reason,
        })
      } else {
        console.warn('[planAgent/dispatch] DO outcome unknown (unrecognized payload)', {
          runToken: message.runToken,
          status: res.status,
        })
        return { transport: 'do', state: 'unknown' }
      }
    } catch (err) {
      console.warn('[planAgent/dispatch] DO outcome unknown (timeout or fetch failed)', {
        runToken: message.runToken,
        err,
      })
      return { transport: 'do', state: 'unknown' }
    } finally {
      clearTimeout(timer)
    }
  }

  // 队列信道（现役默认）：PLAN_AGENT_QUEUE_ENABLED=1 且绑定存在
  const queue = process.env.PLAN_AGENT_QUEUE_ENABLED === '1' ? env?.PLAN_AGENT_QUEUE : undefined
  if (queue) {
    try {
      await queue.send({ ...message, transport: 'queue' })
      return { transport: 'queue', state: 'accepted' }
    } catch (err) {
      console.warn('[planAgent/queue] send failed, falling back to inline SSE', err)
      return { transport: 'none' }
    }
  }
  return { transport: 'none' }
}
