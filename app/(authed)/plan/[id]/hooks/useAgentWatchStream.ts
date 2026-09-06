'use client'

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { createSseFrameReader } from '@/lib/sseFrames'
import { PLANS_CHANGED_EVENT } from '../components/PlanSidebar'
import type { ThinkingTurn } from '../components/ThinkingChain'
import {
  liveToThinkingTurn,
  mergeServerChat,
  type AgentWatchEvent,
  type ChatEntry,
  type InterruptedInfo,
} from '../lib/chatState'
import type { PlanRunSync } from './usePlanRunSync'

/** 断线退避序列（§0.6.3）：依次等这些毫秒重连；全部用尽仍失败则退回 3 秒轮询 */
export const WATCH_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const

export type AgentWatchStream = {
  /** 队列化 run 已投递（202）或刷新后发现服务端仍在跑：开始观察 */
  open: () => void
  /** 主动停止观察（done 收尾、卸载、退回轮询） */
  close: () => void
  /** 观察流模式中（open() 到 done/close 之间）——ui.tsx 用它判断该不该清 busy */
  isOpen: () => boolean
}

/**
 * §0.6 只读观察流：run 在 Cloudflare Queue 里跑，与浏览器连接解耦；本 hook 只负责
 * 「看」——把服务端每 0.5 s 的快照事件映射回页面状态。断了只断观察，run 不受影响；
 * 退避重连仍连不上就把收尾交给 usePlanRunSync 的 3 秒恢复轮询。
 */
export function useAgentWatchStream(input: {
  planId: string
  setChat: Dispatch<SetStateAction<ChatEntry[]>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setSyncBanner: Dispatch<SetStateAction<'reconnecting' | 'in-progress' | null>>
  setInterrupted: Dispatch<SetStateAction<InterruptedInfo | null>>
  setActiveThinking: Dispatch<SetStateAction<ThinkingTurn | null>>
  runSync: PlanRunSync
  /** done 收尾后：清续跑横幅 + 自动续跑入口（与轮询收尾同一个回调） */
  onDone: () => void
  /**
   * run 因用户点「停止」而结束（`done.stopped`）：把观察流最后一帧实况交给
   * ui.tsx 以「已停止」定格（与 POST 流的 `stopped` 事件同一段逻辑）。
   */
  onStopped: (turn: ThinkingTurn | null) => void
}): AgentWatchStream {
  const ref = useRef(input)
  ref.current = input

  // running=处于观察流模式；connected=当前有在途连接（退避等待期间为 false）
  const runningRef = useRef(false)
  const connectedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)
  const lastSeqRef = useRef(0)
  const failuresRef = useRef(0)
  // 观察流推来的最后一帧实况：done.stopped 时用它定格「已停止」的思维链
  const lastLiveTurnRef = useRef<ThinkingTurn | null>(null)
  // 本次连接以 done.reason='rotate' 结束：run 仍在跑，只换连接（不计入退避）
  const rotateRef = useRef(false)

  function clearTimer() {
    if (timerRef.current == null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function close() {
    runningRef.current = false
    connectedRef.current = false
    clearTimer()
    abortRef.current?.abort()
    abortRef.current = null
  }

  function handleEvent(event: AgentWatchEvent) {
    if (typeof event.seq === 'number') lastSeqRef.current = Math.max(lastSeqRef.current, event.seq)
    switch (event.type) {
      case 'live': {
        // 快照重建进行中的思维链（与恢复轮询同一个映射，跨事件不重排工具行）；
        // 自己留一份，done.stopped 时要拿它定格
        const turn = liveToThinkingTurn(event, lastLiveTurnRef.current)
        lastLiveTurnRef.current = turn
        ref.current.setActiveThinking(turn)
        break
      }
      case 'chat': {
        // 服务端全量对话视图：按 revision 幂等，重放不会写坏本地
        const serverChat = Array.isArray(event.chat) ? event.chat : []
        ref.current.runSync.bumpChatEpoch()
        ref.current.setChat((prev) => mergeServerChat(prev, serverChat))
        break
      }
      case 'plan_updated':
        void ref.current.runSync.refreshPlan()
        // 标题生成等元数据变化 → 侧栏会话列表重新拉取
        window.dispatchEvent(new Event(PLANS_CHANGED_EVENT))
        break
      case 'done': {
        // 连接到 15 min 上限而 run 仍在跑：只换连接，不收尾（busy 保持）
        if ((event.reason ?? 'finished') === 'rotate') {
          rotateRef.current = true
          break
        }
        const info = event.interrupted ?? null
        // 用户点了「停止」：先把本轮实况以「已停止」定格进历史，再收尾
        if (event.stopped === true) ref.current.onStopped(lastLiveTurnRef.current)
        // 先关连接再改状态：done 之后不再有事件，避免收尾期间又被重连拉起
        close()
        ref.current.setBusy(false)
        ref.current.setActiveThinking(null)
        ref.current.setSyncBanner(null)
        if (info) {
          ref.current.runSync.noteInterrupted(info)
          ref.current.setInterrupted(info)
        }
        ref.current.onDone()
        break
      }
      case 'ready':
      default:
        break
    }
  }

  function scheduleReconnect() {
    const delay = WATCH_RECONNECT_DELAYS_MS[failuresRef.current]
    failuresRef.current += 1
    if (delay == null) {
      // 退避次数用尽：观察流大概率不可用（路由缺失/代理掐流），交给恢复轮询兜底
      const enterRunRecovery = ref.current.runSync.enterRunRecovery
      close()
      enterRunRecovery('reconnecting')
      return
    }
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void connect()
    }, delay)
  }

  async function connect() {
    if (!runningRef.current || connectedRef.current) return
    connectedRef.current = true
    rotateRef.current = false
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch(`/api/me/plans/${ref.current.planId}/agent/stream?after=${lastSeqRef.current}`, {
        signal: controller.signal,
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || !res.body || !contentType.includes('text/event-stream')) {
        throw new Error('watch stream unavailable')
      }
      for await (const frame of createSseFrameReader(res.body)) {
        // 连上并读到内容即视为一次健康连接：退避计数归零
        failuresRef.current = 0
        handleEvent(frame as AgentWatchEvent)
        if (!runningRef.current || rotateRef.current) break
      }
      endConnection(controller)
    } catch {
      endConnection(controller)
    }
  }

  /** 一次连接结束后的去向：轮换 → 立即重连；其它 → 退避重连 */
  function endConnection(controller: AbortController) {
    connectedRef.current = false
    controller.abort()
    if (abortRef.current === controller) abortRef.current = null
    if (!runningRef.current) return
    if (rotateRef.current) {
      // 服务端主动轮换连接，不是故障：退避计数归零，立刻带着 after=<lastSeq> 接上
      rotateRef.current = false
      failuresRef.current = 0
      clearTimer()
      void connect()
      return
    }
    // 没等到 done 就断了（中间层掐流/网络抖动）：run 可能还在跑，退避重连
    scheduleReconnect()
  }

  function open() {
    if (runningRef.current) return
    runningRef.current = true
    failuresRef.current = 0
    lastSeqRef.current = 0
    lastLiveTurnRef.current = null
    clearTimer()
    void connect()
  }

  // 切后台时移动端浏览器常把长连接掐掉：回到前台且仍在观察模式就立刻重连一次
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') return
      if (!runningRef.current || connectedRef.current) return
      clearTimer()
      void connect()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      close()
    }
    // 仅挂载/卸载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { open, close, isOpen: () => runningRef.current }
}
