import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { handlerLocale, startOfToday } from '@/lib/tripPlan/handlers/plans'
import { planMetaFromAnswer } from '@/lib/planAgent/askUser'
import { agentErrorMessage } from '@/lib/planAgent/netErrors'
import { executePlanAgentRun, AGENT_BUSY_TTL_MS } from '@/lib/planAgent/execute'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { canResume } from '@/lib/planAgent/resume'
import { serverText } from '@/lib/planAgent/serverText'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'

export const runtime = 'nodejs'

const DAILY_MESSAGE_LIMIT = 20

/**
 * 第八轮 A1：客户端断开（刷新/断网）的 abort reason 标记。loop 据此把 run
 * 收尾成 stage=interrupted（GET 暴露 interrupted 字段供前端自动续跑），
 * 与服务端主动结束（无 reason 的普通 abort）区分开。
 */
const CLIENT_DISCONNECTED = 'client_disconnected'

function abortForClientDisconnect(): DOMException {
  return new DOMException(CLIENT_DISCONNECTED, 'AbortError')
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()
  // §0.6：站点语言（x-seichigo-locale > cookie > accept-language）——错误响应
  // 与服务端固定文案走字典，模型回复语言不受它影响（提示词的"回复语言"段）
  const locale = await handlerLocale(deps)
  const errors = serverText(locale).errors

  const session = await deps.getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: errors.notSignedIn }, { status: 401 })

  const plan = await deps.repo.getPlan(id)
  if (!plan) return NextResponse.json({ error: errors.planNotFound }, { status: 404 })
  if (plan.userId !== userId) return NextResponse.json({ error: errors.forbidden }, { status: 403 })

  let message = ''
  let answerTo = ''
  let answerValue: Prisma.JsonValue | undefined
  // 第八轮 A3：{ resume: true }（不带 message）——不追加 human 消息，以当前
  // 落库历史续跑被打断的回合；显式 message 优先（带 message 就是普通回合）
  let resume = false
  // 第十一轮 A3（§0）：{ stop: true }——停止正在运行的 run（一等停止语义，
  // 不是断开连接；断开会按 client_disconnected 记 interrupted 被自动续跑）
  let stop = false
  try {
    const body = (await req.json()) as { message?: unknown; answerTo?: unknown; answerValue?: unknown; resume?: unknown; stop?: unknown }
    if (typeof body.message === 'string') message = body.message.trim()
    if (!message && body.resume === true) resume = true
    if (body.stop === true) stop = true
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

  // A3（§0）+ 第十一轮修复 H1：停止分支——归属已在上方校验。不做
  // isAgentBusy 预检：busy 位过期只代表"可被接管"，不代表没有 run 在跑
  // （token 还在、loop 仍活着）；stopAgentRun 以 token 为准，无 token 时
  // 返回 false。有 run 则原子清 busy/token、写持久停止证据（H2）并写实况
  // 停止标记，运行中的 loop 由租约看守/栅栏在几秒内收尾成 stopped
  if (stop) {
    const stopped = await deps.repo.stopAgentRun(id)
    return NextResponse.json({ ok: true, stopped })
  }

  if (!message && !resume) return NextResponse.json({ error: errors.emptyMessage }, { status: 400 })

  // 第八轮 §0 / F2：对话已自然收尾时无事可续——HTTP 200 告知前端而不是起一个
  // 空 run。canResume 与 GET 的 interrupted 推断共享同一套状态规则（F1 三条），
  // 因此这里要把 listRunLogs 一并传入：尾部 assistant 纯文本但该回合无运行
  // 日志（硬杀）仍可续，有正常日志才是真正的 nothing_to_resume
  if (resume) {
    const [messages, runLogs] = await Promise.all([deps.repo.listMessages(id), deps.repo.listRunLogs(id)])
    if (!canResume(messages, runLogs)) {
      return NextResponse.json({ ok: false, reason: 'nothing_to_resume' })
    }
  }

  // 配额检查、同计划互斥、人类消息落库在同一事务（按用户 advisory lock 串行化）：
  // 并发请求既不能各自烧模型额度，也不能在同一计划上交错写对话历史。
  // 人类消息 content 同时携带原始结构化回答（answerTo/answerValue），供回放
  // 排查与模型直接读到结构化真值；OpenAI 协议对 user 消息的未知字段是宽容的。
  // 第八轮 A3：resume 回合 content=null——不追加 human 消息（配额仍按已落库
  // human 数计算，resume 不新增消息却要烧模型调用，不能绕过当日额度闸门）。
  const begin = await deps.repo.beginAgentRun({
    planId: id,
    userId,
    content: resume
      ? null
      : {
          role: 'user',
          content: message,
          ...(answerTo ? { answerTo, answerValue } : {}),
        },
    since: startOfToday(),
    limit: DAILY_MESSAGE_LIMIT,
    busyTtlMs: AGENT_BUSY_TTL_MS,
  })
  if (begin.status === 'quota_exceeded') {
    return NextResponse.json({ error: errors.agentQuotaExhausted }, { status: 429 })
  }
  if (begin.status === 'busy') {
    return NextResponse.json({ error: errors.planBusy }, { status: 409 })
  }
  const runToken = begin.token

  // 结构化回答 → 元信息直写补丁（纯函数，提前算好）。date_range 的
  // startDate/dayCount 在 agent 启动前就写入，后续 LLM 一进来就能看到
  // "日期已确定"，不必再从自由文本里猜、也不必重复调 update_plan_meta。
  const answerMetaPatch = planMetaFromAnswer(answerTo, answerValue)

  // Task A3（§0.3）：PLAN_AGENT_QUEUE_ENABLED=1（wrangler.jsonc vars；预览
  // 版本会用 --var 覆盖成 0——队列消费者与自引用绑定只对已部署版本生效，
  // 预览跑不了消费者）且有队列绑定时投递队列并 202——run 在 Cloudflare
  // Queue 消费者里跑，与浏览器连接彻底解耦（断流/切后台/刷新都不再杀 run）。
  // answerMetaPatch 直写必须在投递前完成（SSE start() 里的直写与
  // plan_updated 事件都不会发生；观察流会按 plan.updatedAt 推 plan_updated）。
  // 任何一步失败都回落到下方现有 SSE 内联路径（不额外 endAgentRun，SSE
  // 路径的 finally 会释放）。
  const queue =
    process.env.PLAN_AGENT_QUEUE_ENABLED === '1' ? getCfBindings()?.env?.PLAN_AGENT_QUEUE : undefined
  if (queue) {
    let directWriteOk = true
    if (answerMetaPatch) {
      try {
        await deps.repo.updateMetaIfActive(id, runToken, answerMetaPatch)
      } catch (err) {
        console.warn('[planAgent/queue] answerMetaPatch direct write failed, falling back to inline SSE', err)
        directWriteOk = false
      }
    }
    if (directWriteOk) {
      try {
        await queue.send({
          v: 1,
          planId: id,
          runToken,
          locale,
          message: resume ? null : message,
          resume,
          enqueuedAt: new Date().toISOString(),
        })
        return NextResponse.json({ queued: true, runToken }, { status: 202 })
      } catch (err) {
        console.warn('[planAgent/queue] send failed, falling back to inline SSE', err)
      }
    }
  }

  const encoder = new TextEncoder()
  const abort = new AbortController()
  // 两个触发源都是客户端断开（请求 abort / 流 cancel），统一带上 reason 标记
  req.signal.addEventListener('abort', () => abort.abort(abortForClientDisconnect()))

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
        // Task A1：执行体抽到 executePlanAgentRun（deps 组装、renewLease、
        // 标题侧信道、finally { endAgentRun }），SSE 路径与队列内部路由共用
        await executePlanAgentRun({
          repo: deps.repo,
          planId: id,
          runToken,
          locale,
          message,
          resume,
          signal: abort.signal,
          onEvent: send,
          busyTtlMs: AGENT_BUSY_TTL_MS,
        })
      } catch (err) {
        // 循环 try 块之外的异常（历史读取/直写补丁等）与瞬时网络错误统一经
        // agentErrorMessage 映射：网络类按站点语言的友好文案，其余保留原始 message
        send({ type: 'error', message: agentErrorMessage(err, locale) })
        send({ type: 'done' })
      } finally {
        // 无论正常结束、报错还是客户端断开，都要释放 busy 位，
        // 否则该计划要等 TTL 过期才能继续对话（endAgentRun 幂等：token 已
        // 清时是空操作，与执行体内部的 finally 重复调用无害）
        await deps.repo.endAgentRun(id, runToken).catch(() => undefined)
      }
      try {
        controller.close()
      } catch {
        // 已被 cancel
      }
    },
    cancel() {
      abort.abort(abortForClientDisconnect())
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
