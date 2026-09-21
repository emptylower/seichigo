'use client'

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ChatEntryView, TripPlanView } from '@/lib/tripPlan/view'
import {
  liveToThinkingTurn,
  mergeServerChat,
  type ChatEntry,
  type InterruptedInfo,
  type PlanRunLive,
} from '../lib/chatState'
import type { ThinkingTurn } from '../components/ThinkingChain'

export type PlanRunSync = {
  /** plan_updated 事件后重新拉一次计划元数据/行程 */
  refreshPlan: () => Promise<void>
  /** 最近一次 refreshPlan 的 Promise（没有在途刷新时返回已解决的 Promise）：埋点等它落地再读 plan 快照 */
  refreshPlanSettled: () => Promise<void>
  /** 进入断线/跨页恢复轮询（busy 保持 true，由轮询循环收尾） */
  enterRunRecovery: (mode: 'reconnecting' | 'in-progress') => void
  /** 本地流式纪元 +1：让在途轮询响应识别自己已过期 */
  bumpChatEpoch: () => void
  /** 新 run 的流已开始：旧的中断标记随之失效 */
  clearInterrupted: () => void
  /** 观察流 done 带回的中断标记：与轮询同源写入，供自动续跑读取 */
  noteInterrupted: (info: InterruptedInfo) => void
  /** 上一次 run 的中断标记（自动续跑入口读它） */
  readInterrupted: () => InterruptedInfo | null
  /** 恢复轮询是否仍在跑（在跑时由轮询循环负责收尾 busy/banner/thinking） */
  isPolling: () => boolean
}

/**
 * 运行状态对齐（从 ui.tsx 拆出，纯搬运）：挂载核对 + 断线/跨页恢复轮询 +
 * 本地流式纪元。所有可见状态仍由 PlanPlanner 持有，这里只负责按服务端
 * 快照回写；轮询收尾后回调 `onIdle`（自动续跑入口）。
 */
export function usePlanRunSync(input: {
  planId: string
  setPlan: Dispatch<SetStateAction<TripPlanView>>
  setChat: Dispatch<SetStateAction<ChatEntry[]>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setSyncBanner: Dispatch<SetStateAction<'reconnecting' | 'in-progress' | null>>
  setInterrupted: Dispatch<SetStateAction<InterruptedInfo | null>>
  setActiveThinking: Dispatch<SetStateAction<ThinkingTurn | null>>
  /** 轮询/挂载核对到 idle 后：上一次 run 被打断则自动续跑。
   *  `fromRecovery` 区分「真的跑完恢复轮询」与「挂载核对本身就是 idle」——
   *  埋点只对前者补 plan_generated；`hadPlanOutput` 表示轮询窗口内
   *  行程天数/点位数发生变化（纯追问轮不算产出）。 */
  onIdle: (result: { fromRecovery: boolean; hadPlanOutput: boolean }) => Promise<void>
  /**
   * 挂载核对发现服务端仍在跑时的接管者（§0.6.3：改为打开只读观察流，
   * 轮询只作兜底）。未提供时退回原有的 3 秒恢复轮询。
   * `runStartedAt`：核对那一刻服务端给出的 run 启动时刻（GET 的 `runStartedAt`，
   * 源自 TripPlan.agentRunStartedAt），交给观察流当「已用 Ns」的锚点；取不到为 null。
   */
  onRunInProgress?: (info: { runStartedAt: number | null }) => void
}): PlanRunSync {
  const ref = useRef(input)
  ref.current = input
  const { planId } = input

  const lastInterruptedRef = useRef<InterruptedInfo | null>(null)
  // 已应用的服务端 chat 快照键：优先 §0.A2 的 chatRevision，缺省用内容快照；
  // 键不变且仍在跑时跳过整体替换，避免每 3s 轮询触发无意义重渲染
  const lastChatKeyRef = useRef<string | null>(null)
  // 本地流式纪元：每次追加本地条目 +1。轮询响应返回时纪元已变说明请求在途
  // 期间本地已开始新流（响应是旧世界快照），整体替换会冲掉本地内容——
  // 跳过 chat/live 同步（plan 元数据幂等，照常更新）
  const localChatEpochRef = useRef(0)
  const pollingActiveRef = useRef(false)
  // 最近一次核对/轮询反解出的 run 起点锚（服务端最后一条消息时刻），观察流接管时传给它
  const lastRunStartRef = useRef<number | null>(null)
  // 最近一次 refreshPlan 的在途 Promise：plan_updated 后到 done 之间埋点要读最新 plan，
  // 得先等它 settle（拿不到快照也要发事件，只是不带规模参数）
  const pendingRefreshRef = useRef<Promise<void> | null>(null)
  // 最近一次写回的 plan 规模签名（天数:有坐标点位数）：轮询窗口内签名变化 = 出过行程产出
  const lastPlanSignatureRef = useRef<string | null>(null)
  // 本次恢复轮询起步时的 plan 签名：轮询收尾时与最新签名对比得出 hadPlanOutput
  const recoveryStartSignatureRef = useRef<string | null>(null)

  /** plan 规模签名：天数 + 有坐标点位数。只用于「是否变化」的判断，不上报原始值 */
  function planSignature(plan: TripPlanView): string {
    const points = plan.days.reduce((sum, day) => sum + day.items.filter((item) => item.point != null).length, 0)
    return `${plan.days.length}:${points}`
  }

  function notePlan(plan: TripPlanView) {
    ref.current.setPlan(plan)
    lastPlanSignatureRef.current = planSignature(plan)
  }

  async function refreshPlan() {
    const pending = (async () => {
      const res = await fetch(`/api/me/plans/${planId}`)
      if (!res.ok) return
      const body = (await res.json()) as { plan?: TripPlanView }
      if (body.plan) notePlan(body.plan)
    })()
    const tracked = pending.finally(() => {
      if (pendingRefreshRef.current === tracked) pendingRefreshRef.current = null
    })
    pendingRefreshRef.current = tracked
    return tracked
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
      /** §0 本 run 的启动时刻 ISO（busy 且已被领取时才有）：刷新恢复的「已用 Ns」锚点 */
      runStartedAt?: string | null
      live?: PlanRunLive | null
      interrupted?: { at?: unknown; turnIndex?: unknown } | null
    }
    const epochAtStart = localChatEpochRef.current
    try {
      const res = await fetch(`/api/me/plans/${planId}`)
      if (!res.ok) return 'error'
      body = (await res.json()) as typeof body
    } catch {
      return 'error'
    }
    if (body.plan) notePlan(body.plan)
    const agentBusy = body.agentBusy === true
    // 刷新/跨页恢复时的计时锚点：本页没有在途回合，改用服务端记下的 run 启动
    // 时刻（claimAgentRun 领取时原子写入，比点击晚约 1 s——见 planById 注释）
    const parsedRunStart = typeof body.runStartedAt === 'string' ? Date.parse(body.runStartedAt) : NaN
    const runStartedAt = Number.isFinite(parsedRunStart) ? parsedRunStart : null
    lastRunStartRef.current = agentBusy ? runStartedAt : null
    const stale = epochAtStart !== localChatEpochRef.current
    if (!stale) {
      // §0：仅在「最后一条运行日志是中断且其后没有新 run」时下发该标记；新 run 开始后被覆盖为 null
      const raw = body.interrupted
      const marker: InterruptedInfo | null =
        raw && typeof raw.turnIndex === 'number'
          ? { at: typeof raw.at === 'string' ? raw.at : '', turnIndex: raw.turnIndex }
          : null
      lastInterruptedRef.current = marker
      ref.current.setInterrupted(marker)
    }
    // 运行实况：有 live 用服务端快照重建进行中的思维链；live 为空且仍 busy
    // 时清空，ThinkingChain 退化显示"规划师思考中…"
    if (agentBusy && !stale) {
      const live = body.live
      if (live && (typeof live.reasoning === 'string' || Array.isArray(live.toolCalls))) {
        ref.current.setActiveThinking((prev) => liveToThinkingTurn(live, prev, runStartedAt))
      } else {
        ref.current.setActiveThinking(null)
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
        ref.current.setChat((prev) => mergeServerChat(prev, body.chat!))
      }
    }
    return agentBusy ? 'busy' : 'idle'
  }

  /** 断线恢复轮询：服务端 run 在客户端断线后仍在跑，每 3s 对齐直到 agentBusy=false */
  function startAgentRunPolling() {
    if (pollingActiveRef.current) return
    pollingActiveRef.current = true
    // 轮询窗口的产出基线：收尾时签名变了 = 这轮跑出了行程（纯追问轮不算）
    recoveryStartSignatureRef.current = lastPlanSignatureRef.current
    void (async () => {
      while (pollingActiveRef.current) {
        const state = await pollAgentRunOnce()
        if (state === 'idle') break
        await new Promise((resolve) => setTimeout(resolve, 3_000))
      }
      pollingActiveRef.current = false
      ref.current.setSyncBanner(null)
      ref.current.setBusy(false)
      ref.current.setActiveThinking(null)
      const hadPlanOutput =
        recoveryStartSignatureRef.current != null &&
        lastPlanSignatureRef.current != null &&
        recoveryStartSignatureRef.current !== lastPlanSignatureRef.current
      // 轮询到 idle 后发现 run 是被打断的 → 自动续跑（或降级为手动继续）
      await ref.current.onIdle({ fromRecovery: true, hadPlanOutput })
    })()
  }

  function enterRunRecovery(mode: 'reconnecting' | 'in-progress') {
    ref.current.setSyncBanner(mode)
    ref.current.setBusy(true)
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
        // 刷新/另一标签页里 run 仍在跑：优先交给观察流，横幅仍显示「进行中」
        const takeOver = ref.current.onRunInProgress
        if (takeOver) {
          ref.current.setSyncBanner('in-progress')
          ref.current.setBusy(true)
          takeOver({ runStartedAt: lastRunStartRef.current })
        } else {
          enterRunRecovery('in-progress')
        }
        return
      }
      if (state === 'idle') await ref.current.onIdle({ fromRecovery: false, hadPlanOutput: false })
    })()
    return () => {
      cancelled = true
    }
    // 仅首挂载执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 卸载时停掉恢复轮询
  useEffect(
    () => () => {
      pollingActiveRef.current = false
    },
    [],
  )

  return {
    refreshPlan,
    refreshPlanSettled: () => pendingRefreshRef.current ?? Promise.resolve(),
    enterRunRecovery,
    bumpChatEpoch: () => {
      localChatEpochRef.current += 1
    },
    clearInterrupted: () => {
      lastInterruptedRef.current = null
      ref.current.setInterrupted(null)
    },
    noteInterrupted: (info: InterruptedInfo) => {
      lastInterruptedRef.current = info
    },
    readInterrupted: () => lastInterruptedRef.current,
    isPolling: () => pollingActiveRef.current,
  }
}
