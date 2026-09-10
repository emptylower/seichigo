import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { getBillingService } from '@/lib/billing/serverDeps'
import { runCapMicros } from '@/lib/billing/budget'
import { TIER_ENTITLEMENTS } from '@/lib/billing/tiers'
import { AGENT_BUSY_TTL_MS, executePlanAgentRun } from '@/lib/planAgent/execute'
import { isPlanAgentQueueMessage } from '@/lib/planAgent/queueMessage'
import {
  parseConsumerBatchStamp,
  queueDispatchMsOf,
  queueLatencyMsOf,
  selfRefHopMsOf,
} from '@/lib/planAgent/runTimings'

export const runtime = 'nodejs'

/** §0.2：心跳间隔——内部路由用流保持自引用子请求"始终有响应在流" */
const HEARTBEAT_INTERVAL_MS = 15_000

/** §0.5 软截止：队列消费者单次调用 15 分钟硬上限，留 2 分钟给收尾与心跳 */
const SOFT_DEADLINE_MS = 13 * 60_000

function secretsMatch(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  if (aBytes.length !== bBytes.length) return false
  return timingSafeEqual(aBytes, bBytes)
}

/**
 * 队列消费者的内部执行入口（§0.1/0.2）：worker/planAgentConsumer 经
 * WORKER_SELF_REFERENCE 回调本路由，把规划 run 从浏览器连接里解耦出来。
 * - 密钥常量时间校验：未配置 → 503（部署配置错误必须可见），不匹配 → 401；
 * - stale token（已被接管/已结束/token 不符）→ { skipped: 'stale_token' }，
 *   不跑——避免同一回合跑两遍；
 * - 响应为 text/plain 流：每 15 s 一行 heartbeat，run 结束写 done 关闭。
 */
export async function POST(req: Request) {
  const secret = process.env.PLAN_AGENT_INTERNAL_SECRET
  if (!secret) {
    console.error('[api/internal/plan-agent/run] PLAN_AGENT_INTERNAL_SECRET 未配置')
    return NextResponse.json({ error: 'internal secret not configured' }, { status: 503 })
  }
  const provided = req.headers.get('x-plan-agent-secret')
  if (provided === null || !secretsMatch(provided, secret)) {
    console.error('[api/internal/plan-agent/run] 密钥不匹配，拒绝执行')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!isPlanAgentQueueMessage(body)) {
    return NextResponse.json({ error: 'invalid message' }, { status: 400 })
  }

  // B 部分埋点（2026-09-10）：入口实测队列投递延迟（CF Queue 投递 + 消费者
  // isolate 冷启动）。先打一条结构化日志让 wrangler tail 实时可见，run 结束
  // 再随 modelUsage.timings 落库；enqueuedAt 不可解析时只省略差值不炸。
  //
  // C 部分埋点（2026-09-10 第二批）：拆开队列段——消费者在 fetch 前打的
  // 时刻 + invocation 序号（seq=1 → 冷 isolate，时间戳测不出的那个维度）。
  // 旧版消费者的在途消息没有这两个头：consumerBatchAt / consumerSeq /
  // queueDispatchMs / selfRefHopMs 四个字段整体省略，绝不写 0/NaN。
  // queueLatencyMs 保留不动（= queueDispatchMs + selfRefHopMs，对比历史）。
  const consumerEnteredMs = Date.now()
  const consumerEnteredAt = new Date(consumerEnteredMs).toISOString()
  const queueLatencyMs = queueLatencyMsOf(body.enqueuedAt, consumerEnteredMs)
  const stamp = parseConsumerBatchStamp(
    req.headers.get('x-plan-agent-consumer-at'),
    req.headers.get('x-plan-agent-consumer-seq'),
  )
  const queueDispatchMs = stamp ? queueDispatchMsOf(body.enqueuedAt, stamp.consumerBatchMs) : undefined
  const selfRefHopMs = stamp ? selfRefHopMsOf(stamp.consumerBatchAt, consumerEnteredMs) : undefined
  console.log(
    `[planAgent/timing] ${JSON.stringify({
      planId: body.planId,
      enqueuedAt: body.enqueuedAt,
      consumerEnteredAt,
      ...(queueLatencyMs === undefined ? {} : { queueLatencyMs }),
      ...(stamp
        ? {
            consumerBatchAt: stamp.consumerBatchAt,
            consumerSeq: stamp.consumerSeq,
            ...(queueDispatchMs === undefined ? {} : { queueDispatchMs }),
            ...(selfRefHopMs === undefined ? {} : { selfRefHopMs }),
          }
        : {}),
    })}`,
  )

  const deps = await getTripPlanApiDeps()
  // 拿回持有权（POST 投递时写入的 token 仍有效才续）并顺带取回归属用户
  // （CUT-1：单次往返替代原先的整棵 getPlan + renewAgentRun）。计划不存
  // 在、被停止、被接管、已结束都会在这里命中 0 行——直接跳过，绝不重复
  // 执行同一回合
  const owner = await deps.repo.renewAgentRunOwner(body.planId, body.runToken, AGENT_BUSY_TTL_MS)
  if (!owner) {
    return NextResponse.json({ skipped: 'stale_token' })
  }

  // 计费：按计划归属用户的档位装配能力表（队列消息不带 userId）。
  // G3：getAccount 失败必须 fail-closed 回落免费档，绝不能放开全部能力
  const billingAccount = await getBillingService()
    .getAccount(owner.userId)
    .catch((err) => {
      console.error('[api/internal/plan-agent/run] getAccount failed, falling back to free entitlements', err)
      return null
    })
  const billing = billingAccount
    ? { entitlements: billingAccount.entitlements, runCapMicros: billingAccount.runCapMicros }
    : { entitlements: TIER_ENTITLEMENTS.free, runCapMicros: runCapMicros('free') }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const write = (line: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${line}\n`))
        } catch {
          closed = true
        }
      }
      const heartbeat = setInterval(() => write('heartbeat'), HEARTBEAT_INTERVAL_MS)
      try {
        await executePlanAgentRun({
          repo: deps.repo,
          planId: body.planId,
          runToken: body.runToken,
          locale: body.locale,
          message: body.message ?? '',
          resume: body.resume,
          signal: req.signal,
          onEvent: () => undefined,
          busyTtlMs: AGENT_BUSY_TTL_MS,
          deadlineAt: Date.now() + SOFT_DEADLINE_MS,
          billing,
          timing: {
            enqueuedAt: body.enqueuedAt,
            consumerEnteredAt,
            ...(stamp ? { consumerBatchAt: stamp.consumerBatchAt, consumerSeq: stamp.consumerSeq } : {}),
          },
        })
      } catch (err) {
        console.error('[api/internal/plan-agent/run] executePlanAgentRun failed', err)
      } finally {
        clearInterval(heartbeat)
        write('done')
        closed = true
        try {
          controller.close()
        } catch {
          // 已被取消
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}
