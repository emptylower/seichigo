import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { handlerLocale, startOfToday } from '@/lib/tripPlan/handlers/plans'
import { planMetaFromAnswer } from '@/lib/planAgent/askUser'
import { agentErrorMessage } from '@/lib/planAgent/netErrors'
import { executePlanAgentRun, AGENT_BUSY_TTL_MS } from '@/lib/planAgent/execute'
import type { PlanAgentEvent } from '@/lib/planAgent/loop'
import { canResume } from '@/lib/planAgent/resume'
import { formatResetDate, serverText } from '@/lib/planAgent/serverText'
import { getBillingService } from '@/lib/billing/serverDeps'
import { STALE_RESERVE_AFTER_MS } from '@/lib/billing/service'
import { getRunAdmission } from '@/lib/planAgent/runAdmission'
import { dispatchRun, shouldDispatchViaDo } from '@/lib/planAgent/dispatch'
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

  // A 部分（改动 2）：计划归属读与计费账户读互不依赖（一个查 plan 归属、
  // 一个查计费账户），串行两次 DB 往返改为 Promise.all 重叠执行。账户读的
  // 失败包进 outcome、推迟到原 getAccount 位置才暴露——404/403/400 与
  // stop/resume 各拒绝路径本来就不碰计费，语义与先后顺序不变。
  // P2-A：POST 对 plan 的全部消费只有 userId（403 判定）与 agentBusyUntil
  // （撤销预判），归属读改走 1 条 SQL 的最小投影 getPlanAdmission（原先
  // getPlan 的 PLAN_INCLUDE 要 5 条）
  const billing = getBillingService()
  const [plan, accountOutcome] = await Promise.all([
    deps.repo.getPlanAdmission(id),
    billing.getAccount(userId).then(
      (account) => ({ ok: true as const, account }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ])
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

  // P0-B（§3 开关）：全局"新 run 暂停"——置 1 时拒绝新消息与 resume
  // （迁移排空 / 明确过载），stop、GET、观察流不受影响
  if (process.env.PLAN_AGENT_STARTS_PAUSED === '1') {
    return NextResponse.json({ error: errors.serverError, code: 'starts_paused' }, { status: 503 })
  }

  if (!message && !resume) return NextResponse.json({ error: errors.emptyMessage }, { status: 400 })

  // 第八轮 §0 / F2：对话已自然收尾时无事可续——HTTP 200 告知前端而不是起一个
  // 空 run。canResume 与 GET 的 interrupted 推断共享同一套状态规则（F1 三条），
  // 因此这里要把 listRunLogs 一并传入：尾部 assistant 纯文本但该回合无运行
  // 日志（硬杀）仍可续，有正常日志才是真正的 nothing_to_resume。
  // P0-C：再带上当前 run 身份（getAgentRunState）——旧 token 的 stopped 尾
  // 日志不遮蔽新尝试，派发丢失（unclaimed）的回合也可续
  if (resume) {
    const [messages, runLogs, current] = await Promise.all([
      deps.repo.listMessages(id),
      deps.repo.listRunLogs(id),
      deps.repo.getAgentRunState(id),
    ])
    if (!canResume(messages, runLogs, current)) {
      return NextResponse.json({ ok: false, reason: 'nothing_to_resume' })
    }
  }

  // P0-B（不变量 5）：上一轮 token 已过期且从未被领取（派发失败 / 消费者
  // 全灭）→ 先在同一事务里撤销 token + 退回它的 open reserve，再开始本轮。
  // plan.agentBusyUntil 零成本预判：只有"已过期且非 null"才多花一次
  // getAgentRunState 往返。退款先于预算检查落账——本请求开头的账户快照虽
  // 看不到它，下一个请求就能自解被孤儿预扣占住的余量
  if (plan.agentBusyUntil && plan.agentBusyUntil.getTime() < Date.now()) {
    const prior = await deps.repo.getAgentRunState(id)
    if (prior && prior.startedAt === null && prior.busyUntil && prior.busyUntil.getTime() < Date.now()) {
      await getRunAdmission().revokeExpiredUnclaimed({ userId, planId: id, runToken: prior.token })
    }
  }

  // 预算层（设计 §6.2）：孤儿预扣清扫 → 账户只读预检 → 抢 busy 位 + 同步
  // 预扣（P2-A：预扣并入 beginAndReserve 的 begin 事务，先于任何派发）。
  // 预检拦住的请求不落库人类消息；预检通过后并发挤过的极少数请求允许余量
  // 短暂为负。
  // G1：阈值用 STALE_RESERVE_AFTER_MS（软截止 13 分钟 + 两倍 TTL）——真实
  // run 靠续租可跑 13 分钟，比这更短的窗口会把在跑的 run 当孤儿退掉。
  // A 部分共用件：非关键路径任务挂 CF ExecutionContext 的 waitUntil 在响应
  // 之后执行（必须以 cfCtx.waitUntil(...) 宿主方法形式调用，裸方法引用会
  // Illegal invocation）；拿不到 context（next dev / vitest / 节点运行时）
  // 回落同步 await——静默丢弃会让孤儿预扣永远不退
  const cfCtx = getCfBindings()?.ctx
  const runAfterResponse = (task: Promise<void>): Promise<void> => {
    if (cfCtx?.waitUntil) {
      cfCtx.waitUntil(task)
      return Promise.resolve()
    }
    return task
  }
  // A 部分（改动 1）：孤儿预扣清扫清的是**别的 run** 留下的孤儿，与本次请求
  // 的正确性无关——挪出关键路径（砍一次串行往返），经 waitUntil 在响应后执行
  const staleSweep = billing
    .refundStaleReserves(userId, new Date(Date.now() - STALE_RESERVE_AFTER_MS))
    .catch(() => undefined)
  await runAfterResponse(staleSweep)
  // getAccount 已在开头并行发起（改动 2）；错误在此（原 getAccount 位置）
  // 暴露，保持旧行为：走到计费层的请求遇到读库失败 → 未捕获 → 500
  if (!accountOutcome.ok) throw accountOutcome.error
  const account = accountOutcome.account
  if (!account) return NextResponse.json({ error: errors.serverError }, { status: 500 })
  if (!billing.canStartRun(account)) {
    return NextResponse.json(
      {
        error: errors.budgetExhausted.replace('{date}', formatResetDate(locale, account.periodEnd)),
        code: 'budget_exhausted',
        resetsAt: account.periodEnd.toISOString(),
        upgradeAvailable: account.tier === 'free',
      },
      { status: 402 },
    )
  }

  // 配额检查、同计划互斥、人类消息落库在同一事务（按用户 advisory lock 串行化）：
  // 并发请求既不能各自烧模型额度，也不能在同一计划上交错写对话历史。
  // 人类消息 content 同时携带原始结构化回答（answerTo/answerValue），供回放
  // 排查与模型直接读到结构化真值；OpenAI 协议对 user 消息的未知字段是宽容的。
  // 第八轮 A3：resume 回合 content=null——不追加 human 消息（配额仍按已落库
  // human 数计算，resume 不新增消息却要烧模型调用，不能绕过当日额度闸门）。
  // P2-A（不变量 2 合并实现）：预扣并入 begin 事务——admission.beginAndReserve
  // 经 inTx 钩子在"抢到 busy 位 + human 消息落库之后、提交之前"入账 reserve，
  // 省掉整个第二事务（reserveForDispatch 的 ~6 次往返）；token 在同一事务里
  // 生成，token_gone 不可能发生。quota_exceeded / busy 原样透传，不记账
  const begin = await getRunAdmission().beginAndReserve({
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
    account,
  })
  if (begin.status === 'quota_exceeded') {
    return NextResponse.json({ error: errors.agentQuotaExhausted }, { status: 429 })
  }
  if (begin.status === 'busy') {
    return NextResponse.json({ error: errors.planBusy }, { status: 409 })
  }
  const runToken = begin.token

  // P1-A（§4）：首次派发时刻——预扣已随 begin 同事务落账，这里在 begin 成功
  // 之后、首次派发前取一次；内联降级原样携带（消费者按同一时刻起算软截止），
  // 不刷新
  const dispatchedAt = new Date().toISOString()
  const billingInput = { entitlements: account.entitlements, runCapMicros: account.runCapMicros }

  // 结构化回答 → 元信息直写补丁（纯函数，提前算好）。date_range 的
  // startDate/dayCount 在 agent 启动前就写入，后续 LLM 一进来就能看到
  // "日期已确定"，不必再从自由文本里猜、也不必重复调 update_plan_meta。
  const answerMetaPatch = planMetaFromAnswer(answerTo, answerValue)

  // P1-A（联合方案 §3）：transport 选择集中到 dispatchRun——DO alarm（
  // PLAN_AGENT_DISPATCH='do' + canary 白名单）或 Cloudflare Queue（现役默认，
  // 行为与 Phase 0 一致）。answerMetaPatch 直写必须在派发之前（DO/队列路径
  // 都没有 SSE start()，直写与 plan_updated 事件不会发生；观察流按
  // plan.updatedAt 推 plan_updated）。直写失败或没有任何可用 transport 时
  // 回落到下方现有 SSE 内联路径（不额外 endAgentRun，SSE 路径的 finally
  // 会释放）。
  const cfEnv = getCfBindings()?.env
  const hasTransport =
    shouldDispatchViaDo(cfEnv, userId) ||
    (process.env.PLAN_AGENT_QUEUE_ENABLED === '1' && Boolean(cfEnv?.PLAN_AGENT_QUEUE))
  if (hasTransport) {
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
      const outcome = await dispatchRun({
        env: cfEnv,
        message: {
          v: 1,
          planId: id,
          runToken,
          locale,
          message: resume ? null : message,
          resume,
          enqueuedAt: new Date().toISOString(),
          dispatchedAt,
          tier: account.entitlements.tier,
        },
        userId,
      })
      if (outcome.transport !== 'none') {
        // P0-B：预扣已在上方同步完成，202 之前账本里必有 reserve（或管理员豁免）。
        // do/unknown 也返回 202：unknown 表示 DO 可能已持久接纳，绝不改投
        // 队列（双通道竞态），claim 一次性领取保证 alarm 重试只会 winner 或
        // skipped
        return NextResponse.json(
          {
            queued: true,
            runToken,
            dispatchState: outcome.transport === 'do' ? outcome.state : 'accepted',
            transport: outcome.transport,
          },
          { status: 202 },
        )
      }
      // none（队列 send 抛错等）→ 落到下方内联 SSE
    }
  }

  // 内联 SSE 路径（队列不可用 / 投递或直写失败回落）：run 在本请求内执行。
  // 预扣已在上方与队列路径同段同步完成（不变量 2），这里不再重复入账。
  // P0-A 一次性领取：同 token 已被别的执行者领取（队列重投后回落内联等场景）
  // 时这里失败——loser 没有执行副作用，不进下面那个无条件 endAgentRun 的
  // finally（不变量 3），按已排队语义返回 202
  const owner = await deps.repo.claimAgentRun(id, runToken, AGENT_BUSY_TTL_MS)
  if (!owner) {
    return NextResponse.json({ queued: true, runToken }, { status: 202 })
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
          billing: billingInput,
          // P1-A 埋点：内联路径 transport='inline'（时刻与执行体入口兜底同位）
          timing: { consumerEnteredAt: new Date().toISOString(), transport: 'inline' },
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
