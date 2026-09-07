'use client'

import { useState } from 'react'
import Link from 'next/link'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { prefixPath } from '@/components/layout/prefixPath'
import { useBillingPlan } from './useBillingPlan'
import { formatMonthDay } from './usageText'
import { CheckoutUnavailableDialog } from './CheckoutUnavailableDialog'

type Status = 'idle' | 'loading' | 'already' | 'unavailable'

/** 意向来源白名单（与后端 INTENT_SOURCES 对齐；hint/usage 预留给提示位入口） */
export type CheckoutIntentSource = 'pricing' | 'profile' | 'hint' | 'usage'

const DEFAULT_CLASS =
  'w-full rounded-full bg-brand-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60'

/** 已是本档时的非主色块（mt-4 对齐定价卡里其它 CTA 的间距） */
const CURRENT_CLASS =
  'mt-4 block w-full rounded-full border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-700'

/**
 * 开通标准档（设计 §8）：POST /api/me/billing/checkout（body 带 source 供漏斗统计）后跳 Creem 结账页。
 * 401 先去登录再回来（默认回定价页）；403 checkout_disabled 说明订阅暂未开放，弹说明弹窗
 * （不跳登录、不报错）；409 说明已经是标准档；503 与其它一律按“暂不可用”提示，不向用户暴露后端细节。
 * 挂载时先问一次档位：已订阅的用户看到的是当前套餐状态，而不是会被 409 拦住的购买按钮。
 */
export function CheckoutButton(props: {
  locale?: SupportedLocale
  /** 意向来源：定价页 pricing / 账户页 profile / 提示位 hint / 用量位 usage */
  source: CheckoutIntentSource
  /** 覆盖按钮文案，默认用定价页的“开通标准版” */
  label?: string
  /** 401 时登录后的回跳路径，默认当前语言的定价页 */
  callbackUrl?: string
  className?: string
  /** 调用方已经知道档位时跳过状态查询（账户页 SubscriptionCard） */
  skipPlanCheck?: boolean
}) {
  const locale = props.locale ?? 'zh'
  const [status, setStatus] = useState<Status>('idle')
  const [gateOpen, setGateOpen] = useState(false)
  const plan = useBillingPlan(!props.skipPlanCheck)

  async function start(): Promise<void> {
    setStatus('loading')
    try {
      const res = await fetch('/api/me/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: props.source }),
      })
      if (res.status === 401) {
        const back = props.callbackUrl ?? prefixPath('/pricing', locale)
        window.location.assign(`/auth/signin?callbackUrl=${encodeURIComponent(back)}`)
        return
      }
      if (res.status === 403) {
        const data = (await res.json().catch(() => null)) as { code?: string } | null
        // 开关关闭：意向已入后端漏斗，弹“暂未开放”，不跳登录也不显示错误
        if (data?.code === 'checkout_disabled') {
          setStatus('idle')
          setGateOpen(true)
          return
        }
        setStatus('unavailable')
        return
      }
      if (res.status === 409) {
        setStatus('already')
        return
      }
      if (!res.ok) {
        setStatus('unavailable')
        return
      }
      const data = (await res.json().catch(() => null)) as { checkoutUrl?: string } | null
      // F7：跳转前校验协议，非 https 一律按“支付暂不可用”处理
      if (!data?.checkoutUrl || !data.checkoutUrl.startsWith('https://')) {
        setStatus('unavailable')
        return
      }
      // 跳转期间保持 loading，避免用户重复点击。
      window.location.assign(data.checkoutUrl)
    } catch {
      setStatus('unavailable')
    }
  }

  const tier = plan.state === 'ready' ? plan.view.tier : null

  if (tier === 'standard') {
    const end = plan.state === 'ready' && plan.view.cancelAtPeriodEnd && plan.view.currentPeriodEnd
      ? formatMonthDay(plan.view.currentPeriodEnd, locale)
      : ''
    return (
      <div>
        <Link href={prefixPath('/me', locale)} className={CURRENT_CLASS}>
          {`${t('billing.checkout.currentPlan', locale)} · ${t('billing.checkout.manage', locale)}`}
        </Link>
        {end ? (
          <p className="mt-2 text-xs text-gray-500">
            {t('billing.subscription.endsOn', locale).replace('{date}', end)}
          </p>
        ) : null}
      </div>
    )
  }

  if (tier === 'pro') {
    return (
      <div>
        <p className={CURRENT_CLASS}>{t('billing.checkout.currentPlan', locale)}</p>
      </div>
    )
  }

  const busy = status === 'loading' || plan.state === 'loading'

  return (
    <div>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className={props.className ?? DEFAULT_CLASS}
      >
        {busy ? t('billing.checkout.loading', locale) : (props.label ?? t('pages.pricing.standardCta', locale))}
      </button>
      {status === 'already' ? (
        <p className="mt-2 text-xs text-gray-500">
          <span>{t('billing.checkout.alreadySubscribed', locale)}</span>{' '}
          <Link href="/me" className="font-medium text-brand-600 hover:text-brand-500">
            {t('billing.checkout.alreadySubscribedCta', locale)}
          </Link>
        </p>
      ) : null}
      {status === 'unavailable' ? (
        <p className="mt-2 text-xs text-amber-600">{t('billing.checkout.temporarilyUnavailable', locale)}</p>
      ) : null}
      <CheckoutUnavailableDialog open={gateOpen} onClose={() => setGateOpen(false)} locale={locale} />
    </div>
  )
}
