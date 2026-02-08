'use client'

import Link from 'next/link'
import CopyLinkButton from '@/components/resources/CopyLinkButton'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

type Props = {
  articleHref: string
  routeHref: string
  primaryHref: string | null
  locale: SupportedLocale
  navSurface?: string
}

export default function RouteCardActions({
  articleHref,
  routeHref,
  primaryHref,
  locale,
  navSurface = 'resources-card-actions',
}: Props) {
  return (
    <div className="grid w-full grid-cols-3 gap-2" data-nav-surface={navSurface}>
      <Link
        href={articleHref}
        data-nav-surface={navSurface}
        className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
      >
        {t('resources.actions.readOriginal', locale)}
      </Link>
      <CopyLinkButton
        path={routeHref}
        label={t('resources.actions.quoteMap', locale)}
        locale={locale}
        navSurface={navSurface}
        className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 whitespace-nowrap"
      />
      {primaryHref ? (
        <a
          href={primaryHref}
          target="_blank"
          rel="noopener noreferrer"
          data-nav-surface={navSurface}
          className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-brand-500 px-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 whitespace-nowrap"
        >
          {t('resources.actions.openMap', locale)}
        </a>
      ) : (
        <span className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-gray-100 px-2 text-sm font-semibold text-gray-400">
          {t('resources.actions.openMap', locale)}
        </span>
      )}
    </div>
  )
}
