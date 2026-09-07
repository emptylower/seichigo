'use client'

import { useEffect, useState } from 'react'

export type BillingView = {
  tier: 'free' | 'standard' | 'pro'
  hasSubscription: boolean
  status: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/** loading=还没问到；anon=未登录或请求失败（一律按未订阅处理）；ready=拿到档位 */
export type BillingPlan = { state: 'loading' } | { state: 'anon' } | { state: 'ready'; view: BillingView }

/**
 * 挂载后问一次 GET /api/me/billing（设计 §5 契约）。
 * 401 与任何失败都静默落到 anon：拿不到状态就照常给购买入口，不打扰用户。
 * enabled=false 用于调用方已经知道档位的场景（账户页），直接跳过请求。
 */
export function useBillingPlan(enabled = true): BillingPlan {
  const [plan, setPlan] = useState<BillingPlan>(enabled ? { state: 'loading' } : { state: 'anon' })

  useEffect(() => {
    if (!enabled) return
    let alive = true
    void (async () => {
      let next: BillingPlan = { state: 'anon' }
      try {
        const res = await fetch('/api/me/billing', { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as BillingView
          if (typeof data?.tier === 'string') next = { state: 'ready', view: data }
        }
      } catch {
        // 静默：状态未知时按未订阅渲染
      }
      if (alive) setPlan(next)
    })()
    return () => {
      alive = false
    }
  }, [enabled])

  return plan
}
