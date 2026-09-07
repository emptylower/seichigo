import { t } from '@/lib/i18n'
import { toIntlLocale } from '@/lib/i18n/intlLocale'
import type { SupportedLocale } from '@/lib/i18n/types'

/** 用户可见文案（设计 §4）：百分比向下取整；0 < x < 1 显示 "<1%" */
export function formatPercent(percent: number): string {
  if (percent <= 0) return '0%'
  if (percent < 1) return '<1%'
  return `${Math.floor(percent)}%`
}

/**
 * 月日（三语）：zh/ja「9月20日」、en「Sep 20」。
 * 月份写法按语言分：中日用「9月」，英文用缩写月名，日期本身交给 Intl。无效日期返回空串。
 */
export function formatMonthDay(iso: string, locale: SupportedLocale = 'zh'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    month: locale === 'en' ? 'short' : 'long',
    day: 'numeric',
  }).format(d)
}

/** 恢复日期（三语）：zh「9月20日恢复」/ en「Resets on Sep 20」/ ja「9月20日に回復します」。 */
export function formatResetDate(iso: string, locale: SupportedLocale = 'zh'): string {
  const date = formatMonthDay(iso, locale)
  if (!date) return ''
  return t('billing.usage.resets', locale).replace('{date}', date)
}

export type UsageTone = 'ok' | 'low' | 'empty'

export function usageBarTone(percent: number): UsageTone {
  if (percent <= 0) return 'empty'
  if (percent <= 25) return 'low'
  return 'ok'
}
