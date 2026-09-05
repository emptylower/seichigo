'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Home, Menu, RotateCcw, SendHorizontal, Square } from 'lucide-react'
import type { ChatEntryView, TripPlanView } from '@/lib/tripPlan/view'
import { parseDaymapPayload } from '@/lib/tripPlan/view'
import type { AskUserPayload } from '@/lib/planAgent/askUser'
import { AskAnswerChip, AskCard } from './components/AskCard'
import { DayCards, DaymapCard } from './components/DayCards'
import { MarkdownBubble } from './components/MarkdownBubble'
import { PLANS_CHANGED_EVENT, PlanSidebar, type PlanSidebarPlan } from './components/PlanSidebar'
import {
  STOPPED_PHRASE,
  ThinkingChain,
  applyThinkingEvent,
  hasThinkingContent,
  newThinkingTurn,
  type ThinkingTurn,
} from './components/ThinkingChain'
import { usePlanImagePrewarm } from './hooks/usePlanImagePrewarm'
import { useAgentStop } from './hooks/useAgentStop'
import {
  attachThinkingToLast,
  autoResumeStorageKey,
  liveToThinkingTurn,
  mergeServerChat,
  type AgentPostBody,
  type ChatEntry,
  type InterruptedInfo,
  type ModelNotice,
  type PlanRunLive,
  type PlanStreamEvent,
} from './lib/chatState'

const NEAR_BOTTOM_THRESHOLD_PX = 80
const TEXTAREA_MAX_HEIGHT_PX = 144 // ≈ 6 行（text-sm 20px 行高 + 上下 padding）
// busy 为 true 但首帧遥测尚未到达时的兜底（startedAt 不影响进行中态展示）
const EMPTY_THINKING_TURN: ThinkingTurn = { reasoning: '', statusPhrase: null, toolCalls: [], startedAt: 0 }

export function PlanPlanner(props: {
  planId: string
  initialPlan: TripPlanView
  initialChat: ChatEntryView[]
  /** 侧栏会话列表（服务端 listPlans 注入）；PLANS_CHANGED_EVENT 触发客户端重新拉取 */
  plans: PlanSidebarPlan[]
}) {
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
  const lastInterruptedRef = useRef<InterruptedInfo | null>(null)
  // resuming=正在自动续跑；done=无可续内容（短暂提示后淡出）；manual=本会话已自动续过，等用户手动点继续
  const [resumeBanner, setResumeBanner] = useState<'resuming' | 'done' | 'manual' | null>(null)
  const [activeThinking, setActiveThinking] = useState<ThinkingTurn | null>(null)
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
  // 已应用的服务端 chat 快照键：优先 §0.A2 的 chatRevision，缺省用内容快照；
  // 键不变且仍在跑时跳过整体替换，避免每 3s 轮询触发无意义重渲染
  const lastChatKeyRef = useRef<string | null>(null)
  // 本地流式纪元：postAndStream 每次追加本地条目 +1。轮询响应返回时纪元已变
  // 说明请求在途期间本地已开始新流（响应是旧世界快照），整体替换会冲掉本地
  // 内容——跳过 chat/live 同步（plan 元数据幂等，照常更新）
  const localChatEpochRef = useRef(0)
  const pollingActiveRef = useRef(false)

  // B1 停止本轮规划（§0）：POST {stop:true} + 本地兜底 abort + 关掉自动续跑
  const agentStop = useAgentStop(props.planId)

  // 图片预热：挂载即开始；plan.days/daymap 快照的新 URL 只追加到队尾，不打断进行中
  usePlanImagePrewarm(plan.days, chat)

  // 「交给规划师调整」：预填输入框并聚焦（不自动发送）
  const composeDraft = (text: string) => { setInput(text); textareaRef.current?.focus() }

  async function refreshPlan() {
    const res = await fetch(`/api/me/plans/${props.planId}`)
    if (!res.ok) return
    const body = (await res.json()) as { plan?: TripPlanView }
    if (body.plan) setPlan(body.plan)
  }

  /**
   * 轮询对齐一次服务端状态：更新 plan、live 实况（刷新后也能看到规划师在
   * 想什么），并按 chatRevision/内容快照整体替换本地 chat（以服务端为准）。
   * 返回 agentBusy 语义：busy=仍在跑（继续轮询）；idle=已结束；error=网络/
   * 服务不可用（保持轮询，绝不在网络抖动时误判为结束）。
   */
  async function pollAgentRunOnce(): Promise<'busy' | 'idle' | 'error'> {
    let body: {
      plan?: TripPlanView
      chat?: ChatEntryView[]
      agentBusy?: boolean
      chatRevision?: number
      live?: PlanRunLive | null
      interrupted?: { at?: unknown; turnIndex?: unknown } | null
    }
    const epochAtStart = localChatEpochRef.current
    try {
      const res = await fetch(`/api/me/plans/${props.planId}`)
      if (!res.ok) return 'error'
      body = (await res.json()) as typeof body
    } catch {
      return 'error'
    }
    if (body.plan) setPlan(body.plan)
    const agentBusy = body.agentBusy === true
    const stale = epochAtStart !== localChatEpochRef.current
    if (!stale) {
      // §0：仅在「最后一条运行日志是中断且其后没有新 run」时下发该标记；新 run 开始后被覆盖为 null
      const raw = body.interrupted
      const marker: InterruptedInfo | null =
        raw && typeof raw.turnIndex === 'number'
          ? { at: typeof raw.at === 'string' ? raw.at : '', turnIndex: raw.turnIndex }
          : null
      lastInterruptedRef.current = marker
      setInterrupted(marker)
    }
    // 运行实况：有 live 用服务端快照重建进行中的思维链；live 为空且仍 busy
    // 时清空，ThinkingChain 退化显示"规划师思考中…"
    if (agentBusy && !stale) {
      const live = body.live
      if (live && (typeof live.reasoning === 'string' || Array.isArray(live.toolCalls))) {
        setActiveThinking((prev) => liveToThinkingTurn(live, prev))
      } else {
        setActiveThinking(null)
      }
    }
    if (Array.isArray(body.chat) && !stale) {
      // 仅 run 进行中（挂载核对命中 busy）或恢复轮询期间才整体替换：
      // 挂载核对为 idle 时 SSR chat 本就是新的，跳过可避免竞态——核对请求
      // 在途时用户已开始新一轮流式对话，陈旧快照会冲掉本地刚渲染的内容
      const shouldSyncChat = agentBusy || pollingActiveRef.current
      const key =
        typeof body.chatRevision === 'number' ? `rev:${body.chatRevision}` : `snap:${JSON.stringify(body.chat)}`
      // 快照变化（或 run 结束的最后一帧）时整体替换；本地未落库的流式文本在
      // 刷新后本就不存在，断线恢复场景的客户端字段由 mergeServerChat 携带
      if (shouldSyncChat && (key !== lastChatKeyRef.current || !agentBusy)) {
        lastChatKeyRef.current = key
        setChat((prev) => mergeServerChat(prev, body.chat!))
      }
    }
    return agentBusy ? 'busy' : 'idle'
  }

  /** 断线恢复轮询：服务端 run 在客户端断线后仍在跑，每 3s 对齐直到 agentBusy=false */
  function startAgentRunPolling() {
    if (pollingActiveRef.current) return
    pollingActiveRef.current = true
    void (async () => {
      while (pollingActiveRef.current) {
        const state = await pollAgentRunOnce()
        if (state === 'idle') break
        await new Promise((resolve) => setTimeout(resolve, 3_000))
      }
      pollingActiveRef.current = false
      setSyncBanner(null)
      setBusy(false)
      setActiveThinking(null)
      // 轮询到 idle 后发现 run 是被打断的 → 自动续跑（或降级为手动继续）
      await maybeAutoResume()
    })()
  }

  function enterRunRecovery(mode: 'reconnecting' | 'in-progress') {
    setSyncBanner(mode)
    setBusy(true)
    startAgentRunPolling()
  }

  // 首挂载核对运行状态：刷新/另一标签页里 run 仍在跑时进入同样的恢复轮询；
  // idle 但上一次 run 被打断且对话未收尾时，自动发起续跑回合
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const state = await pollAgentRunOnce()
      if (cancelled) return
      if (state === 'busy') {
        enterRunRecovery('in-progress')
        return
      }
      if (state === 'idle') await maybeAutoResume()
    })()
    return () => {
      cancelled = true
    }
    // 仅首挂载执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 卸载时停掉恢复轮询
  useEffect(() => () => {
    pollingActiveRef.current = false
  }, [])

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

  // textarea 自适应高度（≤4 行，超出内部滚动）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [input])

  /** 本地流式追加入口：每次追加推进纪元，让在途轮询响应识别自己已过期 */
  function appendLocalChat(entry: ChatEntry) {
    localChatEpochRef.current += 1
    setChat((prev) => [...prev, entry])
  }

  /**
   * 自动续跑入口：上一次 run 被打断且对话未收尾时，不新增用户消息直接起
   * 「继续」回合。同一页面会话只自动试一次（sessionStorage 记 planId:turnIndex），
   * 再次被打断降级为手动「继续」按钮，避免死循环。
   */
  async function maybeAutoResume() {
    const info = lastInterruptedRef.current
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

    try {
      const res = await fetch(`/api/me/plans/${props.planId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || !res.body || !contentType.includes('text/event-stream')) {
        const errBody = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null
        if (res.ok && errBody?.reason === 'nothing_to_resume') {
          // 对话其实已收尾：只提示，不起 run、不重试
          setResumeBanner('done')
          window.setTimeout(() => setResumeBanner((cur) => (cur === 'done' ? null : cur)), 4_000)
          return
        }
        // 普通轮、答复轮与续跑轮都记录完整请求体，出错后均可原样重试
        appendLocalChat({
          role: 'assistant',
          text: errBody?.error ?? '请求失败，请稍后再试',
          retry: body,
        })
        return
      }

      // 新 run 的流已开始：旧的中断标记随之失效（续跑/新回合都会覆盖它）
      lastInterruptedRef.current = null
      setInterrupted(null)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const line = frame.trim()
            if (!line.startsWith('data:')) continue
            let event: PlanStreamEvent
            try {
              event = JSON.parse(line.slice(5)) as PlanStreamEvent
            } catch {
              continue
            }
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
                localChatEpochRef.current += 1
                break
              }
              case 'daymap': {
                // save_plan_days 的交付快照：与刷新后 toChatView 用同一个载荷
                // 解析器；按 revisionId 去重，客户端重连/事件重放不会重复插入
                const parsed = parseDaymapPayload(event)
                if (!parsed) break
                localChatEpochRef.current += 1
                setChat((prev) =>
                  prev.some((entry) => entry.daymap?.revisionId === parsed.revisionId)
                    ? prev
                    : [...prev, { role: 'assistant', text: '', daymap: parsed }],
                )
                break
              }
              case 'plan_updated':
                await refreshPlan()
                // 标题生成等元数据变化 → 侧栏会话列表重新拉取
                window.dispatchEvent(new Event(PLANS_CHANGED_EVENT))
                break
              case 'error': {
                const thinking = freezeTurn()
                // 偶发网络/运行时错误：附重试入口，用户不必手打重发（答复/续跑轮同样可重试）
                appendLocalChat({
                  role: 'assistant',
                  text: `出错了：${event.message}`,
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
                break
              }
              case 'stopped': {
                // M5 服务端已按用户请求结束本轮：把本轮遥测以「已停止」定格进历史
                // （随后的 done 只看到空 turn，不会再清掉它）
                agentStop.markStopped()
                const frozen = { ...turn, statusPhrase: STOPPED_PHRASE, endedAt: Date.now() }
                turn = newThinkingTurn()
                setActiveThinking(turn)
                localChatEpochRef.current += 1
                setChat((prev) => attachThinkingToLast(prev, frozen, { appendIfNone: true }))
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
        }
      } catch {
        // 本地兜底 abort（点了停止但 5 秒没等到 stopped）：按已停止收尾，不进恢复轮询
        if (agentStop.wasStopped()) return
        // 读流中断（网络抖动/标签页休眠，非 HTTP 错误）：服务端 run 仍在跑，
        // 保留已渲染的聊天与思维链，进入断线恢复轮询；busy 保持 true
        enterRunRecovery('reconnecting')
        return
      }
    } finally {
      // 进入恢复轮询时由轮询循环负责收尾（busy/banner/thinking）
      if (!pollingActiveRef.current) {
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
      appendLocalChat({ role: 'assistant', text: '消息为空，未发送' })
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
                aria-label="打开会话列表"
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 transition hover:bg-pink-50 hover:text-brand-600 lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
              <h1 className="flex-1 truncate text-sm font-semibold text-gray-900">{plan.title}</h1>
              <Link
                href="/"
                aria-label="回到网站"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-pink-50 hover:text-brand-600"
              >
                <Home className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* 单列对话流：消息 + 行程预览 + 地图；底部为输入胶囊预留空间 */}
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-4 pb-40 pt-2">
            {/* 断线/跨页恢复横幅：标题行下方的圆角提示条，宽度随对话列 */}
            {syncBanner ? (
              <div
                role="status"
                className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2 text-center text-xs text-amber-700"
              >
                {syncBanner === 'reconnecting' ? '连接中断，正在同步进度…' : '规划仍在进行中…'}
              </div>
            ) : null}
            {/* B1 停止横幅：用户主动停止本轮规划，复用「继续」的 {resume:true} 逻辑 */}
            {agentStop.stopped ? (
              <div
                role="status"
                className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-center text-xs text-gray-600"
              >
                <span className="inline-flex items-center gap-2">
                  已停止本轮规划。
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      agentStop.clearStopped()
                      void postResume()
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2.5 py-0.5 font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    继续
                  </button>
                </span>
              </div>
            ) : null}
            {/* 断线续跑横幅：自动续跑进行中 / 无可续内容（淡出）/ 本会话已续过（手动继续） */}
            {resumeBanner === 'done' ? (
              <div
                role="status"
                className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2 text-center text-xs text-gray-500"
              >
                上次对话已完成
              </div>
            ) : resumeBanner ? (
              <div
                role="status"
                className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2 text-center text-xs text-amber-700"
              >
                {resumeBanner === 'resuming' ? (
                  '上次规划被打断（页面刷新或网络中断），正在自动继续…'
                ) : (
                  <span className="inline-flex items-center gap-2">
                    上次规划被打断（页面刷新或网络中断）。
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void postResume()}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      继续
                    </button>
                  </span>
                )}
              </div>
            ) : null}
            {chat.length === 0 ? (
              <p className="text-sm text-gray-400">
                试试：“帮我安排下个月中旬去京都，做京吹圣地巡礼的 3 天计划”
              </p>
            ) : null}
          {chat.map((entry, idx) => {
            // daymap 交付物：聊天时间线里的独立条目（不可变快照，只读渲染）
            if (entry.daymap) {
              return <DaymapCard key={`daymap-${entry.daymap.revisionId}`} planId={props.planId} daymap={entry.daymap} onComposeDraft={composeDraft} />
            }
            if (entry.role === 'user') {
              return (
                <div
                  key={idx}
                  className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-brand-50 px-4 py-2 text-sm text-gray-900"
                >
                  {entry.text}
                </div>
              )
            }
            const ask = entry.ask
            // ask 是最后一条 → 可交互组件；否则说明已有后续对话，折叠成摘要 chip
            const isLast = idx === chat.length - 1
            return (
              <div key={idx} className="space-y-2">
                {entry.thinking ? (
                  <ThinkingChain
                    thinking={entry.thinking}
                    active={false}
                    expanded={expandedThinking === `m${idx}`}
                    onToggle={() => setExpandedThinking((cur) => (cur === `m${idx}` ? null : `m${idx}`))}
                  />
                ) : null}
                {ask ? (
                  isLast ? (
                    <AskCard
                      payload={ask}
                      // ask 事件到达时本轮 SSE 可能尚未完全关闭（busy 仍为 true），
                      // 此时禁用交互防止提交被 postAndStream 的 busy 守卫静默丢弃
                      disabled={busy}
                      onSubmit={(answer) =>
                        void postAndStream({ message: answer.readableText, answerTo: ask.askId, answerValue: answer.answerValue })
                      }
                    />
                  ) : (
                    <AskAnswerChip payload={ask} answerText={chat[idx + 1]?.text ?? entry.text} />
                  )
                ) : entry.text || entry.retry ? (
                  <div className="max-w-[92%] rounded-2xl bg-gray-50 px-4 py-2 text-sm text-gray-800">
                    <MarkdownBubble text={entry.text} />
                    {entry.retry ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const retry = entry.retry!
                          // 续跑轮的重试不带 message，走同一个 resume 入口
                          if ('resume' in retry) void postResume()
                          else void postAndStream(retry)
                        }}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        重试
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
          {busy ? (
            <ThinkingChain
              thinking={activeThinking ?? EMPTY_THINKING_TURN}
              active
              // run 被打断（live 空 + interrupted 非空）后、续跑流尚未吐出遥测前，
              // 兜底短语显示「已中断」而不是「思考中」
              idlePhrase={interrupted ? '已中断' : undefined}
              // §0 model_info：供应商不回显思考增量时的头部灰字提示
              modelNotice={modelNotice}
              // 生成中自动展开（有实质内容时），本轮结束后随消息定格自动收起；
              // 用户在本轮内可手动收起/展开，下一轮自动复位
              expanded={activeAutoExpanded}
              onToggle={() => setActiveCollapsed(activeAutoExpanded)}
              followScroll
            />
          ) : null}

          {/* 跟随滚动锚点：daymap 交付物在聊天流内按时间线渲染（见 chat.map），
              锚点保持在流末尾；仅有存量计划、尚无任何 daymap 消息时才在锚点后
              渲染一次"legacy 当前计划"副本——一旦出现真实 daymap 就不再渲染，
              避免同一行程出现两份且旧图被新保存覆盖 */}
          <div ref={chatEndRef} />

          {!chat.some((entry) => entry.daymap) && plan.days.length > 0 ? (
            <div className="pt-4">
              <DayCards planId={props.planId} days={plan.days} scope="current" onComposeDraft={composeDraft} />
            </div>
          ) : null}
          </div>

          {/* 悬浮输入胶囊：包裹层只铺页面底色渐变（无边框、无整幅白块），
              胶囊本体圆角 + 描边 + 阴影；textarea 变高时只有胶囊变高 */}
          <div className="sticky bottom-0 bg-gradient-to-t from-[#fff7fb] via-[#fff7fb]/80 to-transparent">
            <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
              <div className="flex items-end gap-2 rounded-3xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  placeholder={
                    pendingAsk
                      ? '直接输入你的回答，会作为这条提问的自定义答案提交…（Enter 发送）'
                      : '告诉规划师你的巡礼想法…（Enter 发送，Shift+Enter 换行）'
                  }
                  className="max-h-36 flex-1 resize-none overflow-y-auto bg-transparent text-sm outline-none placeholder:text-gray-400"
                />
                {busy ? (
                  <button
                    type="button"
                    aria-label="停止"
                    disabled={agentStop.stopRequested}
                    onClick={() => void agentStop.requestStop()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition hover:bg-gray-700 disabled:opacity-50"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="发送"
                    disabled={!input.trim()}
                    onClick={() => void send()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-50"
                  >
                    <SendHorizontal className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
