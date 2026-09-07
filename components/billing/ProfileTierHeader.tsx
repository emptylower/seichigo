'use client'

import Avatar from '@/components/shared/Avatar'
import { useUsage } from '@/hooks/useUsage'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

type Props = {
  locale: SupportedLocale
  name?: string | null
  email?: string | null
  image?: string | null
}

const CHIP_CLASS: Record<'free' | 'standard' | 'pro', string> = {
  free: 'bg-slate-100 text-slate-600',
  standard: 'bg-brand-100 text-brand-700',
  pro: 'bg-amber-100 text-amber-700',
}

/**
 * 账户页头部：头像（带档位环）+ 用户名/邮箱 + 档位 chip。
 * 用量接口不可用时只隐藏档位信息，名字照常显示（与 UsageMeter 同一原则）。
 */
export function ProfileTierHeader({ locale, name, email, image }: Props) {
  const { usage } = useUsage()
  const tier = usage?.tier
  const displayName = (name ?? '').trim() || (email ?? '').trim() || t('pages.me.title', locale)

  return (
    <div className="flex items-center gap-3">
      <Avatar
        src={image}
        name={displayName}
        size={48}
        tier={tier}
        tierLabel={tier ? t(`billing.tier.${tier}`, locale) : undefined}
      />
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-gray-900">{displayName}</div>
        {tier ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              data-testid="profile-tier-chip"
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_CLASS[tier]}`}
            >
              {t(`billing.tier.${tier}`, locale)}
            </span>
            {tier !== 'free' ? (
              <a href="#subscription" className="text-xs text-brand-600 hover:underline">
                {t('billing.subscription.manageCta', locale)}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
