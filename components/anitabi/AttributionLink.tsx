'use client'

import type { AnchorHTMLAttributes } from 'react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

export const DEFAULT_ANITABI_URL = 'https://anitabi.cn'

type AttributionLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'href'> & {
  href?: string | null
  locale?: SupportedLocale
  label?: string
  className?: string
}

export function getAnitabiAttributionLabel(locale: SupportedLocale = 'zh'): string {
  return t('image.attribution.viaAnitabi', locale)
}

export function buildAnitabiBangumiHref(bangumiId?: number | null): string {
  if (typeof bangumiId !== 'number' || !Number.isFinite(bangumiId) || bangumiId <= 0) {
    return DEFAULT_ANITABI_URL
  }
  return `${DEFAULT_ANITABI_URL}/bangumi/${bangumiId}`
}

export function resolveAnitabiAttributionHref(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const href = String(candidate || '').trim()
    if (!href) continue
    try {
      const url = new URL(href)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString()
      }
    } catch {
      // Ignore malformed URLs and continue to the next candidate.
    }
  }
  return DEFAULT_ANITABI_URL
}

export default function AttributionLink({
  href,
  locale = 'zh',
  label,
  className,
  target,
  rel,
  ...props
}: AttributionLinkProps) {
  const resolvedLabel = String(label || '').trim() || getAnitabiAttributionLabel(locale)
  const resolvedHref = resolveAnitabiAttributionHref(href)
  const resolvedClassName = [
    'inline-flex items-center text-[11px] font-medium text-slate-500 no-underline transition hover:text-brand-600',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <a
      {...props}
      href={resolvedHref}
      target={target || '_blank'}
      rel={rel || 'noreferrer'}
      className={resolvedClassName}
    >
      {resolvedLabel}
    </a>
  )
}
