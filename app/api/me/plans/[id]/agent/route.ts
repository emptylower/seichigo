import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { startOfToday } from '@/lib/tripPlan/handlers/plans'
import { createChatCompletion } from '@/lib/planAgent/api'
import { searchBgmSubjects } from '@/lib/planAgent/bgm'
import { runPlanAgent, type PlanAgentEvent } from '@/lib/planAgent/loop'
import { PrismaPointFinder } from '@/lib/planAgent/pointsPrisma'

export const runtime = 'nodejs'

const DAILY_MESSAGE_LIMIT = 20
// busy 位 TTL：覆盖最坏情况（12 轮 × 慢推理响应），进程崩溃未清锁时到期自动恢复
const AGENT_BUSY_TTL_MS = 10 * 60 * 1000

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()

  const session = await deps.getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const plan = await deps.repo.getPlan(id)
  if (!plan) return NextResponse.json({ error: '计划不存在' }, { status: 404 })
  if (plan.userId !== userId) return NextResponse.json({ error: '无权访问' }, { status: 403 })

  let message = ''
  try {
    const body = (await req.json()) as { message?: unknown }
    if (typeof body.message === 'string') message = body.message.trim()
  } catch {
    // fallthrough
  }
  if (!message) return NextResponse.json({ error: '消息不能为空' }, { status: 400 })

  // 配额检查、同计划互斥、人类消息落库在同一事务（按用户 advisory lock 串行化）：
  // 并发请求既不能各自烧模型额度，也不能在同一计划上交错写对话历史。
  const begin = await deps.repo.beginAgentRun({
    planId: id,
    userId,
    content: { role: 'user', content: message },
    since: startOfToday(),
    limit: DAILY_MESSAGE_LIMIT,
    busyTtlMs: AGENT_BUSY_TTL_MS,
  })
  if (begin.status === 'quota_exceeded') {
    return NextResponse.json({ error: '今日 AI 规划额度已用完，明天再来吧' }, { status: 429 })
  }
  if (begin.status === 'busy') {
    return NextResponse.json({ error: '这个计划正在规划中，等当前回复完成后再发送' }, { status: 409 })
  }
  const runToken = begin.token

  const encoder = new TextEncoder()
  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort())

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PlanAgentEvent | { type: 'ready' }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // 客户端已断开，enqueue 会抛错；agent 循环会在下一轮 signal 检查时停下
        }
      }
      send({ type: 'ready' })
      try {
        await runPlanAgent(
          {
            createMessage: createChatCompletion,
            repo: deps.repo,
            planId: id,
            toolDeps: {
              planId: id,
              repo: deps.repo,
              points: new PrismaPointFinder(),
              bgmSearch: searchBgmSubjects,
            },
            signal: abort.signal,
            userMessagePersisted: true,
            runToken,
          },
          message,
          send,
        )
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : '服务器错误' })
        send({ type: 'done' })
      } finally {
        // 无论正常结束、报错还是客户端断开，都要释放 busy 位，
        // 否则该计划要等 TTL 过期才能继续对话
        await deps.repo.endAgentRun(id, runToken).catch(() => undefined)
      }
      try {
        controller.close()
      } catch {
        // 已被 cancel
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
