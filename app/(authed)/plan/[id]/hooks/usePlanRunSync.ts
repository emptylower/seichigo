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
  /** 进入断线/跨页恢复轮询（busy 保持 true，由轮询循环收尾） */
  enterRunRecovery: (mode: 'reconnecting' | 'in-progress') => void
  /** 本地流式纪元 +1：让在途轮询响应识别自己已过期 */
  bumpChatEpoch: () => void
  /** 新 run 的流已开始：旧的中断标记随之失效 */
  clearInterrupted: () => void
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
  /** 轮询/挂载核对到 idle 后：上一次 run 被打断则自动续跑 */
  onIdle: () => Promise<void>
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

  async function refreshPlan() {
    const res = await fetch(`/api/me/plans/${planId}`)
    if (!res.ok) return
    const body = (await res.json()) as { plan?: TripPlanView }
    if (body.plan) ref.current.setPlan(body.plan)
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
      const res = await fetch(`/api/me/plans/${planId}`)
      if (!res.ok) return 'error'
      body = (await res.json()) as typeof body
    } catch {
      return 'error'
    }
    if (body.plan) ref.current.setPlan(body.plan)
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
      ref.current.setInterrupted(marker)
    }
    // 运行实况：有 live 用服务端快照重建进行中的思维链；live 为空且仍 busy
    // 时清空，ThinkingChain 退化显示"规划师思考中…"
    if (agentBusy && !stale) {
      const live = body.live
      if (live && (typeof live.reasoning === 'string' || Array.isArray(live.toolCalls))) {
        ref.current.setActiveThinking((prev) => liveToThinkingTurn(live, prev))
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
      // 轮询到 idle 后发现 run 是被打断的 → 自动续跑（或降级为手动继续）
      await ref.current.onIdle()
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
        enterRunRecovery('in-progress')
        return
      }
      if (state === 'idle') await ref.current.onIdle()
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
    enterRunRecovery,
    bumpChatEpoch: () => {
      localChatEpochRef.current += 1
    },
    clearInterrupted: () => {
      lastInterruptedRef.current = null
      ref.current.setInterrupted(null)
    },
    readInterrupted: () => lastInterruptedRef.current,
    isPolling: () => pollingActiveRef.current,
  }
}
