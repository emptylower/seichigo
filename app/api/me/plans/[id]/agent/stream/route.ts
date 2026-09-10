import { NextResponse } from 'next/server'
import { getTripPlanApiDeps } from '@/lib/tripPlan/api'
import { handlerLocale } from '@/lib/tripPlan/handlers/plans'
import { readPlanRunState } from '@/lib/tripPlan/handlers/planById'
import { toChatView, type ChatEntryView } from '@/lib/tripPlan/view'
import type { TripPlanRunSnapshotMeta } from '@/lib/tripPlan/repo'
import { serverText } from '@/lib/planAgent/serverText'

export const runtime = 'nodejs'

/** §0.6：快照轮询间隔——与实况行落库节奏（0.6.2 的 500 ms）对齐 */
const POLL_INTERVAL_MS = 500
/** §0.6：单连接最长 15 分钟，到时发 done 关闭（客户端仍 busy 会自动重连） */
const MAX_CONNECTION_MS = 15 * 60_000
/**
 * 2026-09-10 首帧优化（任务三）：await=1 时客户端在发 POST /agent 的同时
 * 开流，busy 位可能还没被抢到——为 run 启动宽限等待的最长时限与重读节奏
 */
const AWAIT_GRACE_MS = 10_000
const AWAIT_POLL_MS = 200
/** 宽限期内的 SSE 心跳注释行间隔（防中间层掐流；客户端 sseFrames 只取 data: 行，注释行被安全忽略） */
const AWAIT_HEARTBEAT_MS = 5_000

function chatRevisionOf(snap: TripPlanRunSnapshotMeta): number {
  // 与 GET 的 chatRevision 同公式（消息数 × 1e14 + 最后一条消息时间戳）；
  // 只当"可能有变化"的触发器用——tool 消息也会动它，推不推 chat 由
  // 可见视图签名（chatSignatureOf）说了算
  return snap.lastMessageAt ? snap.messageCount * 1e14 + snap.lastMessageAt.getTime() : 0
}

/** 可见对话条目的唯一键：daymap 认 revisionId、ask 认 askId、纯文本认 文本+索引 */
function chatEntryKey(entry: ChatEntryView, index: number): string {
  if (entry.daymap) return `daymap:${entry.daymap.revisionId}`
  if (entry.ask) return `ask:${entry.ask.askId}`
  return `text:${index}:${entry.text}`
}

/**
 * 可见视图签名：消息只追加，所以"长度 + 末条 key"足以判定可见对话是否
 * 变化——tool 消息不进 toChatView，追加了也不改签名（不推 chat）。
 */
function chatSignatureOf(chat: ChatEntryView[]): { length: number; lastKey: string | null } {
  const lastIndex = chat.length - 1
  return {
    length: chat.length,
    lastKey: lastIndex >= 0 ? chatEntryKey(chat[lastIndex]!, lastIndex) : null,
  }
}

/**
 * 2026-09-06 §0.6 只读观察流：run 在队列消费者里跑，浏览器通过本路由看
 * 进度——断了只断观察，run 不受影响。每 POLL_INTERVAL_MS 读一次轻量快照
 * （getRunSnapshotMeta），有变化才推事件；agentBusy 变 false 时补发最终
 * chat 与 done{ reason:'finished', stopped, interrupted }（与 GET 的字段同源）
 * 并关闭；连接到 MAX_CONNECTION_MS 上限则发 done{ reason:'rotate' } 关闭
 * （run 仍在跑，客户端立即重连）。
 *
 * 2026-09-10 首帧优化：
 * - `after=0`（全新打开，客户端尚无任何 live/chat 快照）：首个快照不做静默
 *   基线，当前的 live（如有）与 chat 直接作首帧推出，之后照常差异推送；
 *   `after>0`（重连）保持既有静默基线（任务一）。缺省按重连处理（兼容旧
 *   客户端与历史行为）。
 * - `await=1`（任务三，服务端半边）：首个快照 agentBusy=false 时不立即收
 *   幕，进入最长 AWAIT_GRACE_MS 的宽限等待——期间只发 SSE 心跳注释行，
 *   绝不推 chat/live（POST 可能还没落本轮 human 消息，推 chat 会被客户端
 *   整体替换、把用户刚发的话从屏幕上抹掉）；busy 变 true 后按 after 规则
 *   正式开始；超时发 done{ reason:'not_started' }（新 reason，现有客户端
 *   不发 await=1 故收不到）。不带 await=1 时行为与旧版逐字一致。
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const deps = await getTripPlanApiDeps()
  const errors = serverText(await handlerLocale(deps)).errors

  const session = await deps.getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: errors.notSignedIn }, { status: 401 })
  // 非本人一律 404：观察流只对持有者开放，不泄露计划存在性
  const plan = await deps.repo.getPlan(id)
  if (!plan || plan.userId !== userId) {
    return NextResponse.json({ error: errors.planNotFound }, { status: 404 })
  }

  const url = new URL(req.url)
  const awaitRunStart = url.searchParams.get('await') === '1'
  const afterParam = url.searchParams.get('after')
  const freshOpen = afterParam !== null && Number(afterParam) === 0

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seq = 1
      let closed = false
      const send = (event: Record<string, unknown>) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // 客户端已断开——下一轮循环的 signal/异常检查会停掉
          closed = true
        }
      }
      /** 宽限期心跳：SSE 注释行，客户端 sseFrames 只解析 data: 行会安全忽略 */
      const sendComment = () => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          closed = true
        }
      }
      // 可被 abort 提前唤醒的 sleep：req.signal 一触发立刻返回，循环顶部退出
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms)
          req.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true },
          )
        })

      send({ type: 'ready', seq: 0 })
      const startedAt = Date.now()
      let baseline = false
      // 任务三：await=1 的宽限等待状态——runSeenBusy 置位前不收幕、不推帧
      let runSeenBusy = !awaitRunStart
      let lastHeartbeatAt = startedAt
      let lastLiveAt: number | null = null
      let lastChatRevision: number | null = null
      let lastChatSignature: { length: number; lastKey: string | null } | null = null
      let lastPlanRevision: string | null = null

      while (!closed && !req.signal.aborted) {
        const snap = await deps.repo.getRunSnapshotMeta(id)
        if (!snap) {
          // 计划已被删除：按"无事可续"收幕（run 不存在，谈不上 stopped）
          send({ type: 'done', seq: seq++, reason: 'finished', stopped: false, interrupted: null })
          break
        }
        if (!runSeenBusy && !snap.agentBusy) {
          // 任务三宽限等待：POST 可能还没把本轮 human 消息落库——此刻绝不能
          // 推 chat/live（服务端视图比客户端乐观更新还少一条，推过去会被
          // mergeServerChat 整体替换，用户的话会从屏幕上消失），只允许心跳
          if (Date.now() - lastHeartbeatAt >= AWAIT_HEARTBEAT_MS) {
            lastHeartbeatAt = Date.now()
            sendComment()
          }
          if (Date.now() - startedAt >= AWAIT_GRACE_MS) {
            // 宽限超时 run 仍未启动（新 reason；现有客户端不发 await=1，收不到它）
            send({ type: 'done', seq: seq++, reason: 'not_started', stopped: false, interrupted: null })
            break
          }
          await sleep(AWAIT_POLL_MS)
          continue
        }
        runSeenBusy = true
        if (!baseline) {
          // 首个快照建立基线；chat 基线取可见视图签名——GET 给客户端的就是
          // 这份视图，之后只有可见对话真正变化才值得推 chat
          baseline = true
          lastLiveAt = snap.live?.updatedAt.getTime() ?? null
          const chatView = toChatView(await deps.repo.listMessages(id))
          lastChatSignature = chatSignatureOf(chatView)
          lastChatRevision = chatRevisionOf(snap)
          lastPlanRevision = snap.planRevision
          if (freshOpen) {
            // 任务一：全新打开（after=0）时客户端手上没有任何 live/chat 快照
            // ——当前 live（如有）与 chat 就是首帧，不静默吞掉；重复推送对
            // 客户端的 liveToThinkingTurn / mergeServerChat 是幂等的
            if (snap.live) {
              send({
                type: 'live',
                seq: seq++,
                reasoning: snap.live.reasoning,
                statusText: snap.live.statusText,
                toolCalls: Array.isArray(snap.live.toolCalls) ? snap.live.toolCalls : [],
                updatedAt: snap.live.updatedAt.toISOString(),
              })
            }
            send({ type: 'chat', seq: seq++, chatRevision: lastChatRevision, chat: chatView })
          }
        } else {
          if (snap.live && snap.live.updatedAt.getTime() !== lastLiveAt) {
            lastLiveAt = snap.live.updatedAt.getTime()
            send({
              type: 'live',
              seq: seq++,
              reasoning: snap.live.reasoning,
              statusText: snap.live.statusText,
              toolCalls: Array.isArray(snap.live.toolCalls) ? snap.live.toolCalls : [],
              updatedAt: snap.live.updatedAt.toISOString(),
            })
          }
          const revision = chatRevisionOf(snap)
          if (revision !== lastChatRevision) {
            lastChatRevision = revision
            const chat = toChatView(await deps.repo.listMessages(id))
            const signature = chatSignatureOf(chat)
            // 可见对话没变（如只追加了 tool 消息）就不推——chatRevision 只当
            // 触发器，签名才是判据；busy 落幕前的最终 chat 同样走这条规则
            if (
              signature.length !== lastChatSignature?.length ||
              signature.lastKey !== lastChatSignature?.lastKey
            ) {
              lastChatSignature = signature
              send({ type: 'chat', seq: seq++, chatRevision: revision, chat })
            }
          }
          if (snap.planRevision !== lastPlanRevision) {
            lastPlanRevision = snap.planRevision
            send({ type: 'plan_updated', seq: seq++ })
          }
        }
        if (!snap.agentBusy) {
          // 收幕：interrupted/stopped 与 GET 的字段同源（readPlanRunState），
          // 客户端据此走现有自动续跑/停止收尾
          const runState = await readPlanRunState(deps, id)
          send({
            type: 'done',
            seq: seq++,
            reason: 'finished',
            stopped: runState?.stopped ?? false,
            interrupted: runState?.interrupted ?? null,
          })
          break
        }
        if (Date.now() - startedAt >= MAX_CONNECTION_MS) {
          // 连接轮换：run 仍在跑，只是这条连接到 15 min 上限——不是 run 被
          // 打断也不是停止，客户端立即重连即可
          send({ type: 'done', seq: seq++, reason: 'rotate', stopped: false, interrupted: null })
          break
        }
        await sleep(POLL_INTERVAL_MS)
      }
      closed = true
      try {
        controller.close()
      } catch {
        // 已被 cancel
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}
