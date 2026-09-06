'use client'

import { useCallback, useEffect, useState } from 'react'

export type UsageView = {
  tier: 'free' | 'standard' | 'pro'
  tierLabel: string
  remainingPercent: number
  resetsAt: string
  upgradeAvailable: boolean
  hints: { transitEstimateOnly: boolean; restaurantsLocked: boolean; maxDays: number }
}

/** run 结束（SSE done）或 402 后由 Plan 页派发，所有 useUsage 实例重新拉取 */
export const USAGE_CHANGED_EVENT = 'seichigo:usage-changed'

export function notifyUsageChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(USAGE_CHANGED_EVENT))
}

type Status = 'loading' | 'ready' | 'unavailable'

/** 档位差异提示的开关（DayCards/TransitConnector 只需要这两个字段） */
export type TierHints = UsageView['hints']

/**
 * 用量视图（设计 §4）。接口不存在、未登录、网络失败都归为 unavailable：
 * 调用方据此整块隐藏，绝不阻断输入。
 *
 * 每个页面只调用一次（Plan 页在 PlanPlanner，账户页在 UsageMeterClient），
 * 下游组件收 props——DayCards 会随每张 daymap 快照渲染多次，在它内部拉取
 * 会变成一页 N 个请求。
 */
export function useUsage(): { usage: UsageView | null; status: Status; refresh: () => void } {
  const [usage, setUsage] = useState<UsageView | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  const refresh = useCallback(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/me/usage', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as UsageView
        if (cancelled) return
        if (typeof data?.remainingPercent !== 'number' || !data.hints) throw new Error('bad shape')
        setUsage(data)
        setStatus('ready')
      } catch {
        if (cancelled) return
        setUsage(null)
        setStatus('unavailable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = refresh()
    const onChanged = () => {
      refresh()
    }
    window.addEventListener(USAGE_CHANGED_EVENT, onChanged)
    return () => {
      cancel()
      window.removeEventListener(USAGE_CHANGED_EVENT, onChanged)
    }
  }, [refresh])

  return { usage, status, refresh }
}
