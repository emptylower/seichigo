'use client'

import { useState } from 'react'
import Link from 'next/link'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { prefixPath } from '@/components/layout/prefixPath'

type Status = 'idle' | 'loading' | 'already' | 'unavailable'

const DEFAULT_CLASS =
  'w-full rounded-full bg-brand-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * 开通标准档（设计 §8）：POST /api/me/billing/checkout 后跳 Creem 结账页。
 * 401 先去登录再回来（默认回定价页）；409 说明已经是标准档；
 * 503 与其它一律按“暂不可用”提示，不向用户暴露后端细节。
 */
export function CheckoutButton(props: {
  locale?: SupportedLocale
  /** 覆盖按钮文案，默认用定价页的“开通标准版” */
  label?: string
  /** 401 时登录后的回跳路径，默认当前语言的定价页 */
  callbackUrl?: string
  className?: string
}) {
  const locale = props.locale ?? 'zh'
  const [status, setStatus] = useState<Status>('idle')

  async function start(): Promise<void> {
    setStatus('loading')
    try {
      const res = await fetch('/api/me/billing/checkout', { method: 'POST' })
      if (res.status === 401) {
        const back = props.callbackUrl ?? prefixPath('/pricing', locale)
        window.location.assign(`/auth/signin?callbackUrl=${encodeURIComponent(back)}`)
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
      if (!data?.checkoutUrl) {
        setStatus('unavailable')
        return
      }
      // 跳转期间保持 loading，避免用户重复点击。
      window.location.assign(data.checkoutUrl)
    } catch {
      setStatus('unavailable')
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void start()}
        disabled={status === 'loading'}
        className={props.className ?? DEFAULT_CLASS}
      >
        {status === 'loading' ? t('billing.checkout.loading', locale) : (props.label ?? t('pages.pricing.standardCta', locale))}
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
        <p className="mt-2 text-xs text-amber-600">{t('billing.checkout.unavailable', locale)}</p>
      ) : null}
    </div>
  )
}
