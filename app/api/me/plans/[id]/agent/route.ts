import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { startOfToday } from '@/lib/tripPlan/handlers/plans'
import { createChatCompletion, generatePlanTitle } from '@/lib/planAgent/api'
import { planMetaFromAnswer } from '@/lib/planAgent/askUser'
import { searchBgmSubjects } from '@/lib/planAgent/bgm'
import { agentErrorMessage } from '@/lib/planAgent/netErrors'
import { runPlanAgent, type PlanAgentEvent } from '@/lib/planAgent/loop'
import { PrismaPointFinder } from '@/lib/planAgent/pointsPrisma'
import { getPlanAgentServerDeps } from '@/lib/planAgent/serverDeps'
import { maybeSetGeneratedTitle } from '@/lib/planAgent/title'

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
  let answerTo = ''
  let answerValue: Prisma.JsonValue | undefined
  try {
    const body = (await req.json()) as { message?: unknown; answerTo?: unknown; answerValue?: unknown }
    if (typeof body.message === 'string') message = body.message.trim()
    // 结构化回答：answerTo 是 ask_user 落库的 askId，answerValue 形状按
    // 交互基数 kind 区分（date_range: {startDate, dayCount} | {monthHint,
    // dayCount}；single_choice: {optionId}；multi_choice: {optionIds}；
    // 自定义输入统一为 {custom}）。提问的任务语义（taskType：日期/选作品/
    // 意见）只影响前端渲染哪个组件，不影响回答形状。只做形状归一，不强制
    // 校验——畸形值会在 planMetaFromAnswer 里被忽略，模型仍能读到人类可读文本。
    if (typeof body.answerTo === 'string' && body.answerTo.trim()) {
      answerTo = body.answerTo.trim()
      // undefined 不是合法 JsonValue，归一为 null；unknown 断言点收敛在这一处
      answerValue = (body.answerValue ?? null) as Prisma.JsonValue
    }
  } catch {
    // fallthrough
  }
  if (!message) return NextResponse.json({ error: '消息不能为空' }, { status: 400 })

  // 配额检查、同计划互斥、人类消息落库在同一事务（按用户 advisory lock 串行化）：
  // 并发请求既不能各自烧模型额度，也不能在同一计划上交错写对话历史。
  // 人类消息 content 同时携带原始结构化回答（answerTo/answerValue），供回放
  // 排查与模型直接读到结构化真值；OpenAI 协议对 user 消息的未知字段是宽容的。
  const begin = await deps.repo.beginAgentRun({
    planId: id,
    userId,
    content: {
      role: 'user',
      content: message,
      ...(answerTo ? { answerTo, answerValue } : {}),
    },
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

  // 结构化回答 → 元信息直写补丁（纯函数，提前算好）。date_range 的
  // startDate/dayCount 在 agent 启动前就写入，后续 LLM 一进来就能看到
  // "日期已确定"，不必再从自由文本里猜、也不必重复调 update_plan_meta。
  const answerMetaPatch = planMetaFromAnswer(answerTo, answerValue)

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
        // 直写走 run-token 栅栏（updateMetaIfActive）：与其它 agent 运行期写入
        // 一样参与并发正确性保护；刚拿到 token 就写入，实际不可能被拦（null
        // 仅出现在被接管的窗口里，此时静默跳过即可）
        if (answerMetaPatch) {
          const applied = await deps.repo.updateMetaIfActive(id, runToken, answerMetaPatch)
          if (applied) send({ type: 'plan_updated' })
        }
        await Promise.all([
          runPlanAgent(
            {
              createMessage: createChatCompletion,
              repo: deps.repo,
              planId: id,
              toolDeps: {
                planId: id,
                repo: deps.repo,
                points: new PrismaPointFinder(),
                bgmSearch: searchBgmSubjects,
                ...getPlanAgentServerDeps(id),
              },
              signal: abort.signal,
              userMessagePersisted: true,
              runToken,
            },
            message,
            send,
          ),
          // 标题侧信道：与主循环并行的一次轻量标题生成，让标题在第一轮
          // 消息后就出现（不走 run-token 栅栏，见 lib/planAgent/title.ts）
          maybeSetGeneratedTitle(
            {
              repo: deps.repo,
              planId: id,
              createTitle: (userMessage) => generatePlanTitle(userMessage, abort.signal),
              onTitleUpdated: () => send({ type: 'plan_updated' }),
            },
            message,
          ),
        ])
      } catch (err) {
        // 循环 try 块之外的异常（历史读取/直写补丁等）与瞬时网络错误统一经
        // agentErrorMessage 映射：网络类 → 友好中文，其余保留原始 message
        send({ type: 'error', message: agentErrorMessage(err) })
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
