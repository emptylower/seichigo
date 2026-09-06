import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { AGENT_BUSY_TTL_MS, executePlanAgentRun } from '@/lib/planAgent/execute'
import { isPlanAgentQueueMessage } from '@/lib/planAgent/queueMessage'

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

  const deps = await getTripPlanApiDeps()
  const plan = await deps.repo.getPlan(body.planId)
  if (!plan) {
    return NextResponse.json({ skipped: 'stale_token' })
  }

  // 拿回持有权（POST 投递时写入的 token 仍有效才续）：被停止/被接管/已结束
  // 都会在这里失败——直接跳过，绝不重复执行同一回合
  const renewed = await deps.repo.renewAgentRun(body.planId, body.runToken, AGENT_BUSY_TTL_MS)
  if (!renewed) {
    return NextResponse.json({ skipped: 'stale_token' })
  }

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
