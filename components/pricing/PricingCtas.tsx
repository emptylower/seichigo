'use client'

import Link from 'next/link'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { useBillingPlan } from '@/components/billing/useBillingPlan'

/**
 * 免费档 CTA：定价页静态渲染出未登录文案（“当前可用”），
 * 客户端问到档位后，登录且仍是免费档的用户改成“当前套餐”。链接目标不变。
 */
export function PricingFreeCta(props: {
  locale: SupportedLocale
  href: string
  label: string
  className?: string
}) {
  const plan = useBillingPlan()
  const current = plan.state === 'ready' && plan.view.tier === 'free'
  return (
    <Link href={props.href} className={props.className}>
      {current ? t('billing.checkout.currentPlan', props.locale) : props.label}
    </Link>
  )
}
