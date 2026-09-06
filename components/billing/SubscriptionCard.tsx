'use client'

import { useCallback, useEffect, useState } from 'react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { notifyUsageChanged } from '@/hooks/useUsage'
import { CheckoutButton } from './CheckoutButton'
import { formatMonthDay } from './usageText'

export type BillingView = {
  tier: 'free' | 'standard' | 'pro'
  hasSubscription: boolean
  status: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/** 从 Creem 结账页回来后轮询开通结果：3 秒一次，最多 30 秒（设计 §8） */
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 10

/**
 * 账户页订阅区块（设计 §8）：免费档给升级入口，有订阅时给 Creem 客户门户。
 * 接口不可用（未登录 / 未上线 / 网络失败）整块隐藏，与用量表一致，绝不挡住页面其余部分。
 */
export function SubscriptionCard(props: { locale?: SupportedLocale; pendingActivation?: boolean }) {
  const locale = props.locale ?? 'zh'
  const pending = Boolean(props.pendingActivation)
  const [view, setView] = useState<BillingView | null>(null)
  const [polls, setPolls] = useState(0)
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalError, setPortalError] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/billing', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as BillingView
      if (typeof data?.tier !== 'string') throw new Error('bad shape')
      setView(data)
    } catch {
      setView(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const tier = view?.tier
  useEffect(() => {
    if (!pending || tier === 'standard' || polls >= MAX_POLLS) return
    const id = setTimeout(() => {
      setPolls((n) => n + 1)
      void load().then(() => {
        notifyUsageChanged()
      })
    }, POLL_INTERVAL_MS)
    return () => clearTimeout(id)
  }, [pending, tier, polls, load])

  async function openPortal(): Promise<void> {
    setPortalBusy(true)
    setPortalError(false)
    try {
      const res = await fetch('/api/me/billing/portal', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { portalUrl?: string }
      if (!data?.portalUrl) throw new Error('missing portalUrl')
      window.location.assign(data.portalUrl)
    } catch {
      setPortalError(true)
      setPortalBusy(false)
    }
  }

  if (!view) return null

  const periodDate = view.currentPeriodEnd ? formatMonthDay(view.currentPeriodEnd, locale) : ''
  const periodText = periodDate
    ? t(view.cancelAtPeriodEnd ? 'billing.subscription.endsOn' : 'billing.subscription.renewsOn', locale).replace(
        '{date}',
        periodDate,
      )
    : ''
  const note = pending ? t(tier === 'standard' ? 'billing.subscription.activated' : 'billing.subscription.pending', locale) : ''

  return (
    <section
      aria-label={t('billing.subscription.sectionLabel', locale)}
      className="rounded-2xl border border-pink-100 bg-white px-5 py-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {t('billing.subscription.current', locale).replace('{tier}', t(`billing.tier.${view.tier}`, locale))}
          </p>
          {periodText ? <p className="mt-1 text-xs text-gray-500">{periodText}</p> : null}
        </div>
        {view.hasSubscription ? (
          <button
            type="button"
            onClick={() => void openPortal()}
            disabled={portalBusy}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('billing.subscription.manageCta', locale)}
          </button>
        ) : (
          <CheckoutButton
            locale={locale}
            callbackUrl="/me"
            label={t('billing.subscription.upgradeCta', locale)}
            className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
        )}
      </div>
      {note ? <p className="mt-3 text-xs text-brand-600">{note}</p> : null}
      {portalError ? (
        <p className="mt-2 text-xs text-amber-600">{t('billing.subscription.portalError', locale)}</p>
      ) : null}
    </section>
  )
}
