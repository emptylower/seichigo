'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Home, Menu } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import { createSseFrameReader } from '@/lib/sseFrames'
import { notifyUsageChanged, useUsage } from '@/hooks/useUsage'
import { planTextFor } from './lib/planText'
import type { ChatEntryView, TripPlanView } from '@/lib/tripPlan/view'
import { parseDaymapPayload } from '@/lib/tripPlan/view'
import type { AskUserPayload } from '@/lib/planAgent/askUser'
import type { AskAnswer } from './components/AskCard'
import { ChatPane } from './components/ChatPane'
import { PlanComposer } from './components/PlanComposer'
import { PLANS_CHANGED_EVENT, PlanSidebar, type PlanSidebarPlan } from './components/PlanSidebar'
import {
  applyThinkingEvent,
  hasThinkingContent,
  newThinkingTurn,
  stoppedPhrase,
  type ThinkingTurn,
} from './components/ThinkingChain'
import { usePlanImagePrewarm } from './hooks/usePlanImagePrewarm'
import { useAgentStop } from './hooks/useAgentStop'
import { usePendingDraft } from './hooks/usePendingDraft'
import { usePlanRunSync } from './hooks/usePlanRunSync'
import { useAgentWatchStream, type WatchConnectionState } from './hooks/useAgentWatchStream'
import {
  attachThinkingToLast,
  autoResumeStorageKey,
  type AgentPostBody,
  type ChatEntry,
  type InterruptedInfo,
  type ModelNotice,
  type PlanStreamEvent,
} from './lib/chatState'

const NEAR_BOTTOM_THRESHOLD_PX = 80

export function PlanPlanner(props: {
  planId: string
  initialPlan: TripPlanView
  initialChat: ChatEntryView[]
  /** 侧栏会话列表（服务端 listPlans 注入）；PLANS_CHANGED_EVENT 触发客户端重新拉取 */
  plans: PlanSidebarPlan[]
  /** 站点语言（服务端注入；文案接线由 Lane B 落地，缺省 zh） */
  locale?: SupportedLocale
}) {
  const locale = props.locale ?? 'zh'
  const tx = planTextFor(locale)
  const [plan, setPlan] = useState(props.initialPlan)
  const [chat, setChat] = useState<ChatEntry[]>(props.initialChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // 移动端会话列表抽屉（桌面常驻侧栏不涉及）
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // 断线恢复/跨标签页恢复：reconnecting=本页读流中断；in-progress=挂载时发现服务端仍在跑
  const [syncBanner, setSyncBanner] = useState<'reconnecting' | 'in-progress' | null>(null)
  // 断线续跑：服务端标记上一次 run 被打断；轮询/挂载核对读取后经 maybeAutoResume 消费
  const [interrupted, setInterrupted] = useState<InterruptedInfo | null>(null)
  // resuming=正在自动续跑；done=无可续内容（短暂提示后淡出）；manual=本会话已自动续过，等用户手动点继续
  const [resumeBanner, setResumeBanner] = useState<'resuming' | 'done' | 'manual' | null>(null)
  // 本月用量耗尽（/agent 返回 402）：输入禁用 + 提示条，直到下次刷新拿到真实状态
  const [budgetExhausted, setBudgetExhausted] = useState<{ message: string; upgradeAvailable: boolean } | null>(null)
  const [activeThinking, setActiveThinking] = useState<ThinkingTurn | null>(null)
  // C2 观察流连接健康度：degraded 时进行中思维链 pill 换「连接不稳，重试中」
  const [watchConnState, setWatchConnState] = useState<WatchConnectionState>('live')
  // §0 model_info：当前模型不公开思考过程时的头部灰字提示（reasoning=true 时为 null）
  const [modelNotice, setModelNotice] = useState<ModelNotice | null>(null)
  // 展开哪条历史思维链：`m${idx}`（消息定格）——纯 UI 状态，不参与跟随滚动
  const [expandedThinking, setExpandedThinking] = useState<string | null>(null)
  // 进行中思维链默认自动展开；用户在本轮内手动点收起后置 true，下一轮自动复位
  const [activeCollapsed, setActiveCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // B1 停止本轮规划（§0）：POST {stop:true} + 本地兜底 abort + 关掉自动续跑
  const agentStop = useAgentStop(props.planId)

  // 本月 agent 用量（设计 §4）：全页唯一来源，侧栏用量表与行程卡档位提示都由此向下传
  const { usage } = useUsage()

  // 图片预热：挂载即开始；plan.days/daymap 快照的新 URL 只追加到队尾，不打断进行中
  usePlanImagePrewarm(plan.days, chat)

  // 「交给规划师调整」：预填输入框并聚焦（不自动发送）
  const composeDraft = (text: string) => { setInput(text); textareaRef.current?.focus() }

  // `/plan/start` 交接过来的第一条消息：空计划自动发出，已有对话只预填
  usePendingDraft({
    hasMessages: props.initialChat.length > 0,
    onAutoSend: (text) => (busy ? false : (void postAndStream({ message: text }), true)),
    onPrefill: composeDraft,
  })

  // 运行状态对齐：挂载核对 + 断线/跨页恢复轮询 + 本地流式纪元（见 usePlanRunSync）
  const runSync = usePlanRunSync({
    planId: props.planId,
    setPlan,
    setChat,
    setBusy,
    setSyncBanner,
    setInterrupted,
    setActiveThinking,
    onIdle: () => maybeAutoResume(),
    // 刷新后发现服务端仍在跑：观察流接管进度，轮询只在观察流连不上时兜底
    onRunInProgress: () => watch.open(),
  })

  // §0.6 只读观察流：run 在队列里跑时的进度来源（done 事件负责收尾）
  const watch = useAgentWatchStream({
    planId: props.planId,
    setChat,
    setBusy,
    setSyncBanner,
    setInterrupted,
    setActiveThinking,
    runSync,
    onDone: () => {
      setResumeBanner((cur) => (cur === 'resuming' ? null : cur))
      // 队列化 run 的收尾同样刷新用量（POST 流的 done 分支在 streamAgentRequest 里）
      notifyUsageChanged()
      void maybeAutoResume()
    },
    // done.stopped：不再依赖 useAgentStop 的 5 秒兜底，直接按「已停止」定格
    onStopped: (turn) => freezeStoppedTurn(turn),
    onConnectionState: setWatchConnState,
  })

  function handleScroll() {
    const el = scrollRef.current
    const end = chatEndRef.current
    if (!el || !end) return
    // "在底部"的语义 = 对话流的末尾（chatEndRef）在视口底沿附近。
    // 不能用量滚动容器绝对底部：DayCards 行程卡片在锚点之后且很高，
    // 滚到对话末尾时离容器底部还差整个行程的高度，会被误判为"不在底部"而停止跟随。
    const distanceToChatEnd = end.getBoundingClientRect().top - el.getBoundingClientRect().bottom
    nearBottomRef.current = distanceToChatEnd < NEAR_BOTTOM_THRESHOLD_PX
  }

  // 仅当用户视口本就在底部附近时才跟随滚动，避免翻看历史时被拽回底部
  useEffect(() => {
    if (!nearBottomRef.current) return
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat, busy, plan.days.length])

  /**
   * 「已停止」定格（M5）：把本轮遥测以停止短语挂进历史。POST 流的 `stopped`
   * 事件与观察流的 `done.stopped` 共用这一段——两条路径的收尾必须一致。
   */
  function freezeStoppedTurn(turn: ThinkingTurn | null) {
    agentStop.markStopped()
    const frozen = { ...(turn ?? newThinkingTurn()), statusPhrase: stoppedPhrase(locale), endedAt: Date.now() }
    runSync.bumpChatEpoch()
    setChat((prev) => attachThinkingToLast(prev, frozen, { appendIfNone: true }))
  }

  /** 本地流式追加入口：每次追加推进纪元，让在途轮询响应识别自己已过期 */
  function appendLocalChat(entry: ChatEntry) {
    runSync.bumpChatEpoch()
    setChat((prev) => [...prev, entry])
  }

  /**
   * 自动续跑入口：上一次 run 被打断且对话未收尾时，不新增用户消息直接起
   * 「继续」回合。同一页面会话只自动试一次（sessionStorage 记 planId:turnIndex），
   * 再次被打断降级为手动「继续」按钮，避免死循环。
   */
  async function maybeAutoResume() {
    const info = runSync.readInterrupted()
    if (!info) return
    // sessionStorage 不可用（隐私模式等）时按未记录处理，仍尝试续跑一次
    let recorded: string | null = null
    try {
      recorded = window.sessionStorage.getItem(autoResumeStorageKey(props.planId))
    } catch { /* 按未记录处理 */ }
    if (recorded != null) {
      setResumeBanner('manual')
      return
    }
    try {
      window.sessionStorage.setItem(autoResumeStorageKey(props.planId), `${props.planId}:${info.turnIndex}`)
    } catch { /* 不影响本次续跑 */ }
    setResumeBanner('resuming')
    await streamAgentRequest({ resume: true })
  }

  /** 手动「继续」：与自动续跑同一个请求，由用户点击触发（不受 sessionStorage 限制） */
  async function postResume() {
    setResumeBanner('resuming')
    await streamAgentRequest({ resume: true })
  }

  /**
   * /agent 流式请求核心：普通轮、答复轮与续跑轮（{resume:true}）共用。
   * 不做 busy 守卫与本地 user 气泡追加——那是 postAndStream 包装层的职责；
   * 自动续跑从轮询收尾的旧闭包里调用，busy 快照不可靠。
   */
  async function streamAgentRequest(body: AgentPostBody) {
    setBusy(true)
    const signal = agentStop.beginRun()
    setModelNotice(null)
    // 发起新回合（含续跑）时强制跟随到底部（常规 chat 行为）
    nearBottomRef.current = true
    // 本轮思维链累积器：本地变量跨帧累积（state 更新是异步的），state 只负责实时渲染
    let turn = newThinkingTurn()
    setActiveThinking(turn)
    setExpandedThinking(null)
    setActiveCollapsed(false)

    // 定格当前累积的思维链并开启下一段（多轮"模型→工具"循环时每段 text 各挂一份）
    const freezeTurn = (): ThinkingTurn | undefined => {
      const frozen = { ...turn, endedAt: Date.now() }
      turn = newThinkingTurn()
      setActiveThinking(turn)
      return hasThinkingContent(frozen) ? frozen : undefined
    }

    // 观察流与 POST 并行开（§0.6 阶段三）：POST 内部有多次串行数据库往返，先把
    // 观察流以 awaitStart 开出去（run 未启动时服务端宽限等待），把投递耗时从首字
    // 延迟里拿掉。await=1 只出现在本次 open 的第一次连接（见 useAgentWatchStream）
    watch.open({ awaitStart: true })
    // 只有「202 已投递」这一条路径让观察流活到 done；内联 SSE 回落与所有错误
    // 路径（含 fetch 抛错）都必须关掉它——否则页面挂着一条永远等不到 run 的流
    let watchKeepsRunning = false
    const closeWatchUnlessQueued = () => {
      if (!watchKeepsRunning) watch.close()
    }
    try {
      const res = await fetch(`/api/me/plans/${props.planId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      // 队列化 run（§0.3）：POST 只负责投递，202 之后进度改由只读观察流推送；
      // busy 保持 true，收尾交给观察流的 done 事件
      if (res.status === 202) {
        const queued = (await res.json().catch(() => null)) as { queued?: boolean } | null
        if (queued?.queued === true) {
          watchKeepsRunning = true
          runSync.clearInterrupted()
          return
        }
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || !res.body || !contentType.includes('text/event-stream')) {
        // 观察流等不到 run 了：先关掉，再走既有错误分支
        closeWatchUnlessQueued()
        const errBody = (await res.json().catch(() => null)) as
          | { error?: string; reason?: string; code?: string; upgradeAvailable?: boolean }
          | null
        // 本月用量已用完：不当作请求失败塞进对话，只禁用输入并给恢复日期与升级入口
        if (res.status === 402 && errBody?.code === 'budget_exhausted') {
          setBudgetExhausted({
            message: errBody.error ?? '本月 AI 规划用量已用完',
            upgradeAvailable: Boolean(errBody.upgradeAvailable),
          })
          notifyUsageChanged()
          return
        }
        if (res.ok && errBody?.reason === 'nothing_to_resume') {
          // 对话其实已收尾：只提示，不起 run、不重试
          setResumeBanner('done')
          window.setTimeout(() => setResumeBanner((cur) => (cur === 'done' ? null : cur)), 4_000)
          return
        }
        // 普通轮、答复轮与续跑轮都记录完整请求体，出错后均可原样重试
        appendLocalChat({
          role: 'assistant',
          text: errBody?.error ?? tx('errors.requestFailed'),
          retry: body,
        })
        return
      }

      // 队列不可用时的内联 SSE 回落：必须先关观察流再读本流——两条路径不能同时写同一份状态
      closeWatchUnlessQueued()
      // 新 run 的流已开始：旧的中断标记随之失效（续跑/新回合都会覆盖它）
      runSync.clearInterrupted()

      try {
        for await (const raw of createSseFrameReader(res.body)) {
          const event = raw as PlanStreamEvent
          switch (event.type) {
            case 'text': {
              const thinking = freezeTurn()
              appendLocalChat({ role: 'assistant', text: event.text, thinking })
              break
            }
            case 'ask': {
              // ask_user 结构化提问：本体挂 ask 字段，prompt 同时作 text 降级展示；
              // 本轮对话就此结束（后端随后会发 done）
              const thinking = freezeTurn()
              const ask: AskUserPayload = {
                askId: event.askId,
                kind: event.kind,
                taskType: event.taskType,
                prompt: event.prompt,
                options: event.options,
                allowSkip: event.allowSkip,
              }
              setChat((prev) => [...prev, { role: 'assistant', text: event.prompt, ask, thinking }])
              runSync.bumpChatEpoch()
              break
            }
            case 'daymap': {
              // save_plan_days 的交付快照：与刷新后 toChatView 用同一个载荷
              // 解析器；按 revisionId 去重，客户端重连/事件重放不会重复插入
              const parsed = parseDaymapPayload(event)
              if (!parsed) break
              runSync.bumpChatEpoch()
              setChat((prev) =>
                prev.some((entry) => entry.daymap?.revisionId === parsed.revisionId)
                  ? prev
                  : [...prev, { role: 'assistant', text: '', daymap: parsed }],
              )
              break
            }
            case 'plan_updated':
              await runSync.refreshPlan()
              // 标题生成等元数据变化 → 侧栏会话列表重新拉取
              window.dispatchEvent(new Event(PLANS_CHANGED_EVENT))
              break
            case 'error': {
              const thinking = freezeTurn()
              // 偶发网络/运行时错误：附重试入口，用户不必手打重发（答复/续跑轮同样可重试）
              appendLocalChat({
                role: 'assistant',
                text: tx('errors.streamError', { message: event.message }),
                thinking,
                retry: body,
              })
              break
            }
            case 'done': {
              // 回合末尾仍残留未挂接的遥测（最后一段只有工具调用没有正文）时，
              // 挂到最近一条还没有思维链的 assistant 消息上
              const frozen = { ...turn, endedAt: Date.now() }
              turn = newThinkingTurn()
              if (hasThinkingContent(frozen)) setChat((prev) => attachThinkingToLast(prev, frozen))
              // 一轮跑完，用量已变：让侧栏/账户页的用量表重新拉取
              notifyUsageChanged()
              break
            }
            case 'stopped': {
              // 服务端已按用户请求结束本轮：定格后本地 turn 复位
              // （随后的 done 只看到空 turn，不会再清掉它）
              freezeStoppedTurn(turn)
              turn = newThinkingTurn()
              setActiveThinking(turn)
              break
            }
            case 'model_info':
              // reasoning=false：该供应商不回显思考增量，头部提示只显示工具进度
              setModelNotice(event.reasoning ? null : { providerName: event.providerName, model: event.model })
              break
            case 'status':
            case 'reasoning':
            case 'tool_call':
              turn = applyThinkingEvent(turn, event)
              setActiveThinking(turn)
              break
          }
        }
      } catch {
        // 本地兜底 abort（点了停止但 5 秒没等到 stopped）：按已停止收尾，不进恢复轮询
        if (agentStop.wasStopped()) return
        // 读流中断（网络抖动/标签页休眠，非 HTTP 错误）：服务端 run 仍在跑，
        // 保留已渲染的聊天与思维链，进入断线恢复轮询；busy 保持 true
        runSync.enterRunRecovery('reconnecting')
        return
      }
    } finally {
      // fetch 抛错（含用户点停止的 abort）等未显式关闭的路径在此兜底
      closeWatchUnlessQueued()
      // 进入恢复轮询或观察流模式时，由它们负责收尾（busy/banner/thinking）
      if (!runSync.isPolling() && !watch.isOpen()) {
        setBusy(false)
        setActiveThinking(null)
        setResumeBanner((cur) => (cur === 'resuming' ? null : cur))
      }
    }
  }

  async function postAndStream(body: { message: string; answerTo?: string; answerValue?: unknown }) {
    // 任何路径都不得向 /agent 发送空 message（服务端 400"消息不能为空"）：
    // 本地追加提示并直接返回，不发请求
    if (!body.message.trim()) {
      appendLocalChat({ role: 'assistant', text: tx('errors.emptyMessage') })
      return
    }
    if (busy) return
    appendLocalChat({ role: 'user', text: body.message })
    await streamAgentRequest(body)
  }

  // 进行中思维链的自动展开态：有实质遥测内容且用户本轮未手动收起
  const activeAutoExpanded = busy && activeThinking != null && hasThinkingContent(activeThinking) && !activeCollapsed

  // 待回答的结构化提问：最后一条消息是 ask 且本轮没有进行中的请求。
  // 此时全局输入框的直发内容作为该 ask 的自定义回答回传（带 askId），
  // 而不是开启一条无关的普通聊天轮——这是选择卡之外的最终兜底入口。
  const pendingAsk = (() => {
    if (busy) return null
    const last = chat[chat.length - 1]
    if (!last || last.role !== 'assistant' || !last.ask) return null
    return last.ask
  })()

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    if (pendingAsk) {
      await postAndStream({ message, answerTo: pendingAsk.askId, answerValue: { custom: message } })
      return
    }
    await postAndStream({ message })
  }

  return (
    <div data-layout-wide="true" data-layout-immersive="true" className="flex h-dvh">
      {/* 左侧会话列表：桌面常驻侧栏，移动端标题行菜单按钮开抽屉 */}
      <PlanSidebar
        plans={props.plans}
        currentPlanId={props.planId}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        usage={usage}
        locale={locale}
      />

      {/* 对话列：标题行（sticky top）+ 消息流 + 悬浮输入胶囊（sticky bottom）
          共用一个滚动容器；保留 data-layout-wide/-immersive 隐藏站点 header/footer */}
      <div ref={scrollRef} onScroll={handleScroll} className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {/* 标题行：白底 + 底边框（沉浸布局下不再是透明毛玻璃） */}
          <div className="sticky top-0 z-10 border-b border-gray-100 bg-white">
            <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-3">
              <button
                type="button"
                aria-label={tx('sidebar.openList')}
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 transition hover:bg-pink-50 hover:text-brand-600 lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
              <h1 className="flex-1 truncate text-sm font-semibold text-gray-900">{plan.title}</h1>
              <Link
                href="/"
                aria-label={tx('common.backHome')}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-pink-50 hover:text-brand-600"
              >
                <Home className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <ChatPane
            planId={props.planId}
            chat={chat}
            days={plan.days}
            busy={busy}
            syncBanner={syncBanner}
            stopped={agentStop.stopped}
            onResumeAfterStop={() => {
              agentStop.clearStopped()
              void postResume()
            }}
            resumeBanner={resumeBanner}
            onResume={() => void postResume()}
            expandedThinking={expandedThinking}
            onToggleHistoryThinking={(key) => setExpandedThinking((cur) => (cur === key ? null : key))}
            activeThinking={activeThinking}
            activeExpanded={activeAutoExpanded}
            onToggleActiveThinking={() => setActiveCollapsed(activeAutoExpanded)}
            interrupted={interrupted != null}
            modelNotice={modelNotice}
            watchConnState={watchConnState}
            onComposeDraft={composeDraft}
            onAnswerAsk={(ask, answer: AskAnswer) =>
              void postAndStream({ message: answer.readableText, answerTo: ask.askId, answerValue: answer.answerValue })
            }
            onRetry={(retry) => {
              // 续跑轮的重试不带 message，走同一个 resume 入口
              if ('resume' in retry) void postResume()
              else void postAndStream(retry)
            }}
            chatEndRef={chatEndRef}
            tierHints={usage?.hints ?? null}
            locale={locale}
          />

          <PlanComposer
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            busy={busy}
            answering={pendingAsk != null}
            stopRequested={agentStop.stopRequested}
            onStop={() => void agentStop.requestStop()}
            budgetNotice={budgetExhausted}
            textareaRef={textareaRef}
            locale={locale}
          />
        </div>
      </div>
    </div>
  )
}
