'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ChevronDown, MessageCircleMore } from 'lucide-react'
import type { SiteLocale } from './SiteShell'
import { t } from '@/lib/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type Props = {
  locale: SiteLocale
  variant?: 'desktop' | 'drawer'
}

function CommunityDetails({ locale, compact = false }: { locale: SiteLocale; compact?: boolean }) {
  return (
    <div className={compact ? 'px-3 pb-4 pt-3' : 'px-4 pb-4 pt-3'}>
      <Image
        src="/images/community/qq-group-qr.webp"
        alt={t('header.communityQrAlt', locale)}
        width={660}
        height={660}
        sizes={compact ? '240px' : '272px'}
        className={`mx-auto aspect-square w-full object-contain ${compact ? 'max-w-60' : 'max-w-[17rem]'}`}
        unoptimized
      />
      <p className="mt-3 text-center text-sm font-medium text-slate-700">
        {t('header.communityScanHint', locale)}
      </p>
    </div>
  )
}

export default function CommunityMenu({ locale, variant = 'desktop' }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const label = t('header.community', locale)

  if (variant === 'drawer') {
    return (
      <div>
        <button
          type="button"
          onClick={() => setDrawerOpen((current) => !current)}
          className="group flex h-12 w-full items-center justify-between px-3 text-slate-700 transition hover:bg-slate-50 hover:text-brand-700"
          aria-expanded={drawerOpen}
          aria-controls="mobile-community-panel"
          data-testid="header-community-drawer-trigger"
        >
          <span className="inline-flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-brand-100/70 group-hover:text-brand-600">
              <MessageCircleMore className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-medium">{label}</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-300 transition-transform ${drawerOpen ? 'rotate-180 text-brand-400' : 'group-hover:text-brand-400'}`} />
        </button>

        {drawerOpen ? (
          <div id="mobile-community-panel" className="border-t border-slate-100 bg-slate-50/60">
            <div className="flex items-center gap-2 px-4 pt-4">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-600">
                <MessageCircleMore className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">SeichiGo QQ {t('header.communityGroup', locale)}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t('header.communityGroupNumber', locale)} 901491088</p>
              </div>
            </div>
            <CommunityDetails locale={locale} compact />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex min-h-11 items-center gap-1 text-gray-900 transition hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2"
          data-testid="header-community-trigger"
        >
          <span>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform group-data-[state=open]:rotate-180 group-data-[state=open]:text-brand-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[min(19rem,calc(100vw-2rem))] overflow-hidden rounded-lg border-slate-200 bg-white p-0 shadow-[0_18px_50px_-18px_rgba(15,23,42,0.4)]"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-600">
            <MessageCircleMore className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">SeichiGo QQ {t('header.communityGroup', locale)}</p>
            <p className="mt-0.5 text-xs text-slate-500">{t('header.communityGroupNumber', locale)} 901491088</p>
          </div>
        </div>
        <CommunityDetails locale={locale} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
