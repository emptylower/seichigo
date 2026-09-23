'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { RouteBookSummary } from '../types'
import { RouteBookSelector } from './RouteBookSelector'
import { tr } from '../../i18n'

interface RouteBookPlannerHeaderProps {
  routeBookId: string
  routeBooks: RouteBookSummary[]
  locale?: SupportedLocale
}

export function RouteBookPlannerHeader({
  routeBookId,
  routeBooks,
  locale = 'zh',
}: RouteBookPlannerHeaderProps) {
  return (
    <section>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <RouteBookSelector items={routeBooks} currentId={routeBookId} locale={locale} />
        </div>
        <Link
          href="/me/routebooks"
          prefetch={false}
          aria-label={tr('routebook.selector.newOrManage', locale)}
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] bg-brand-400 text-white no-underline shadow-[0_16px_30px_-22px_rgba(225,29,72,0.8)] transition hover:bg-brand-500"
        >
          <Plus className="h-6 w-6" />
        </Link>
      </div>
    </section>
  )
}
