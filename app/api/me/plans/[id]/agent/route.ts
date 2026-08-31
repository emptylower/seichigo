import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { startOfToday } from '@/lib/tripPlan/handlers/plans'
import { createChatCompletion } from '@/lib/planAgent/api'
import { searchBgmSubjects } from '@/lib/planAgent/bgm'
import { runPlanAgent, type PlanAgentEvent } from '@/lib/planAgent/loop'
import { PrismaPointFinder } from '@/lib/planAgent/pointsPrisma'

export const runtime = 'nodejs'

const DAILY_MESSAGE_LIMIT = 20

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

  // 配额检查与人类消息落库在同一事务（按用户 advisory lock 串行化），
  // 并发请求无法同时通过检查后各自烧模型额度。
  const humanMessage = await deps.repo.appendHumanMessageIfWithinQuota({
    planId: id,
    userId,
    content: { role: 'user', content: message },
    since: startOfToday(),
    limit: DAILY_MESSAGE_LIMIT,
  })
  if (!humanMessage) {
    return NextResponse.json({ error: '今日 AI 规划额度已用完，明天再来吧' }, { status: 429 })
  }

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
          },
          message,
          send,
        )
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : '服务器错误' })
        send({ type: 'done' })
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
