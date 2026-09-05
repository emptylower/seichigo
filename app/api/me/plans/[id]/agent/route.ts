import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { startOfToday } from '@/lib/tripPlan/handlers/plans'
import { createChatCompletion, generatePlanTitle, withModelUsageInRunLog } from '@/lib/planAgent/api'
import { planMetaFromAnswer } from '@/lib/planAgent/askUser'
import { searchBgmSubjects } from '@/lib/planAgent/bgm'
import { agentErrorMessage } from '@/lib/planAgent/netErrors'
import { runPlanAgent, type PlanAgentEvent } from '@/lib/planAgent/loop'
import { PrismaPointFinder } from '@/lib/planAgent/pointsPrisma'
import { canResume, RESUME_NOTE } from '@/lib/planAgent/resume'
import { RunFencedError } from '@/lib/planAgent/runFence'
import { getPlanAgentServerDeps } from '@/lib/planAgent/serverDeps'
import { maybeSetGeneratedTitle } from '@/lib/planAgent/title'

export const runtime = 'nodejs'

const DAILY_MESSAGE_LIMIT = 20
// busy 位 TTL（第九轮 L1）：90 秒——硬杀（isolate 直接被杀、finally 不执行）后
// 最长 90 秒释放 busy 位，前端就能自动续跑（旧值 3 分钟等太久）。活着的 run
// 由循环在每次模型调用前与每次工具执行前的续租保住持有权（见下方 renewLease
// 与 loop.ts），单次慢推理或长工具（save_plan_days）期间也不会被误判过期
const AGENT_BUSY_TTL_MS = 90 * 1000

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

  const session = await deps.getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const plan = await deps.repo.getPlan(id)
  if (!plan) return NextResponse.json({ error: '计划不存在' }, { status: 404 })
  if (plan.userId !== userId) return NextResponse.json({ error: '无权访问' }, { status: 403 })

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

  if (!message && !resume) return NextResponse.json({ error: '消息不能为空' }, { status: 400 })

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
    return NextResponse.json({ error: '今日 AI 规划额度已用完，明天再来吧' }, { status: 429 })
  }
  if (begin.status === 'busy') {
    return NextResponse.json({ error: '这个计划正在规划中，等当前回复完成后再发送' }, { status: 409 })
  }
  const runToken = begin.token

  // 第九轮 L1：租约续租（token 匹配才续，被接管后自动失效）。循环在每次
  // 模型调用前与每次工具执行前调用，save_plan_days 内部还会再续两次；被
  // 接管 → 抛 RunFencedError 结束本 run（现有栅栏语义）；瞬时库错误不打断对话
  const renewLease = async (): Promise<void> => {
    const renewed = await deps.repo.renewAgentRun(id, runToken, AGENT_BUSY_TTL_MS).catch(() => true)
    if (!renewed) throw new RunFencedError()
  }

  const encoder = new TextEncoder()
  const abort = new AbortController()
  // 两个触发源都是客户端断开（请求 abort / 流 cancel），统一带上 reason 标记
  req.signal.addEventListener('abort', () => abort.abort(abortForClientDisconnect()))

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
              repo: withModelUsageInRunLog(deps.repo),
              planId: id,
              renewLease,
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
              // 第十一轮 A3（§0）：模型流式期间的停止检查（租约看守定期
              // 轮询，发现 token 已被 stopAgentRun 清掉就 abort 模型请求）
              isStopped: () => deps.repo.isAgentRunStopped(id, runToken),
              // 第八轮 A3：resume 回合注入中断说明（loop 拼进本回合 [系统状态]，
              // 仅内存不落库），模型从已保存的进度继续
              ...(resume ? { resumeNote: RESUME_NOTE } : {}),
            },
            message,
            send,
          ),
          // 标题侧信道：与主循环并行的一次轻量标题生成，让标题在第一轮
          // 消息后就出现（不走 run-token 栅栏，见 lib/planAgent/title.ts）。
          // resume 无新用户消息可作标题素材，跳过
          ...(message
            ? [
                maybeSetGeneratedTitle(
                  {
                    repo: deps.repo,
                    planId: id,
                    createTitle: (userMessage) => generatePlanTitle(userMessage, abort.signal),
                    onTitleUpdated: () => send({ type: 'plan_updated' }),
                  },
                  message,
                ),
              ]
            : []),
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
