'use client'

import Link from 'next/link'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { prefixPath } from '@/components/layout/prefixPath'
import type { UsageView } from '@/hooks/useUsage'
import { formatPercent, formatResetDate, usageBarTone, type UsageTone } from './usageText'

const BAR_TONE: Record<UsageTone, string> = {
  ok: 'bg-brand-500',
  low: 'bg-amber-500',
  empty: 'bg-gray-300',
}

/**
 * 用量表（设计 §4）：只显示百分比、恢复日期、档位名与升级入口。
 * compact 用于 Plan 侧栏底部，full 用于账户页。
 * 档位名按 `usage.tier` 从三语字典取（接口的 `tierLabel` 只有中文，不再使用）。
 */
export function UsageMeter(props: { usage: UsageView | null; size: 'compact' | 'full'; locale?: SupportedLocale }) {
  const { usage, size } = props
  const locale = props.locale ?? 'zh'
  if (!usage) return null
  const percent = Math.max(0, Math.min(100, usage.remainingPercent))
  const tone = usageBarTone(percent)
  const compact = size === 'compact'
  const remaining = t('billing.usage.remaining', locale).replace(
    '{percent}',
    formatPercent(usage.nearlyEmpty ? 0.5 : percent),
  )
  return (
    <section
      aria-label={t('billing.usage.sectionLabel', locale)}
      className={
        compact
          ? 'rounded-xl border border-pink-100 bg-white/70 px-3 py-2.5'
          : 'rounded-2xl border border-pink-100 bg-white px-5 py-4 shadow-sm'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className={compact ? 'text-xs font-medium text-gray-700' : 'text-sm font-semibold text-gray-900'}>
          {remaining}
        </p>
        <span className="shrink-0 rounded-full bg-pink-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">
          {t(`billing.tier.${usage.tier}`, locale)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={`mt-2 w-full overflow-hidden rounded-full bg-gray-100 ${compact ? 'h-1.5' : 'h-2'}`}
      >
        <div className={`h-full rounded-full transition-[width] ${BAR_TONE[tone]}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-gray-400">
        <span>{formatResetDate(usage.resetsAt, locale)}</span>
        {usage.upgradeAvailable ? (
          <Link href={prefixPath('/pricing', locale)} className="font-medium text-brand-600 hover:text-brand-500">
            {t('billing.usage.upgradeCta', locale)}
          </Link>
        ) : null}
      </div>
    </section>
  )
}
