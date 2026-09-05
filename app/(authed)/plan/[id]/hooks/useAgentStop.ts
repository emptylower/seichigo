'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { autoResumeStorageKey } from '../lib/chatState'

/** 服务端 stopped 事件的等待上限：超时后本地 abort 读流（服务端最终也会停） */
export const STOP_FALLBACK_ABORT_MS = 5_000

export type AgentStopController = {
  /** 已发出停止请求、尚未收到 stopped */
  stopRequested: boolean
  /** 本轮已按「停止」收尾（收到 stopped 或本地兜底 abort） */
  stopped: boolean
  /** 每轮流式请求开始时调用：复位停止态并返回本轮 fetch 的 AbortSignal */
  beginRun: () => AbortSignal
  /** 点击「停止」：POST {stop:true} + 关掉自动续跑 + armed 兜底 abort */
  requestStop: () => Promise<void>
  /** 流里收到 {type:'stopped'} */
  markStopped: () => void
  /** 用户点「继续」后清掉停止横幅 */
  clearStopped: () => void
  /** 读流异常时判定是否是本地停止导致（是则不进断线恢复轮询） */
  wasStopped: () => boolean
}

/**
 * B1 停止本轮规划（§0 契约）。停止是服务端可识别的一等语义：先 POST
 * `{stop:true}`，服务端在下一次租约检查/流式看守时结束 run 并发 stopped；
 * 5 秒内没等到就本地 abort 读流。停止的同时把本页会话的自动续跑标记写成
 * 已消费，保证刷新/轮询收尾时 maybeAutoResume 不会把它续起来。
 */
export function useAgentStop(planId: string): AgentStopController {
  const [stopRequested, setStopRequested] = useState(false)
  const [stopped, setStopped] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)
  const stoppedRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const markStopped = useCallback(() => {
    clearTimer()
    stoppedRef.current = true
    setStopRequested(false)
    setStopped(true)
  }, [clearTimer])

  const beginRun = useCallback(() => {
    clearTimer()
    stoppedRef.current = false
    setStopRequested(false)
    setStopped(false)
    const controller = new AbortController()
    controllerRef.current = controller
    return controller.signal
  }, [clearTimer])

  const requestStop = useCallback(async () => {
    if (stoppedRef.current) return
    setStopRequested(true)
    // 停止后不自动续跑：本页会话的自动续跑名额直接记为已消费
    try {
      window.sessionStorage.setItem(autoResumeStorageKey(planId), `${planId}:stopped`)
    } catch {
      /* 隐私模式等：仍按已停止处理，服务端也不会再下发 interrupted */
    }
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      controllerRef.current?.abort()
      markStopped()
    }, STOP_FALLBACK_ABORT_MS)
    try {
      await fetch(`/api/me/plans/${planId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stop: true }),
      })
    } catch {
      /* 服务端不可达：兜底 abort 仍会在 5 秒后收尾 */
    }
  }, [planId, clearTimer, markStopped])

  const clearStopped = useCallback(() => {
    clearTimer()
    stoppedRef.current = false
    setStopRequested(false)
    setStopped(false)
  }, [clearTimer])

  const wasStopped = useCallback(() => stoppedRef.current, [])

  useEffect(() => () => clearTimer(), [clearTimer])

  return { stopRequested, stopped, beginRun, requestStop, markStopped, clearStopped, wasStopped }
}
