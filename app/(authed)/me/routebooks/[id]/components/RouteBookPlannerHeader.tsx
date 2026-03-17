'use client'

import Link from 'next/link'
import { Plus, Sparkles } from 'lucide-react'
import type { RouteBookDetail, RouteBookSummary } from '../types'
import { RouteBookSelector } from './RouteBookSelector'

interface RouteBookPlannerHeaderProps {
  routeBookId: string
  routeBooks: RouteBookSummary[]
}

export function RouteBookPlannerHeader({
  routeBookId,
  routeBooks,
}: RouteBookPlannerHeaderProps) {
  return (
    <section>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <RouteBookSelector items={routeBooks} currentId={routeBookId} />
        </div>
        <Link
          href="/me/routebooks"
          prefetch={false}
          aria-label="新建或管理地图"
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] bg-brand-400 text-white no-underline shadow-[0_16px_30px_-22px_rgba(225,29,72,0.8)] transition hover:bg-brand-500"
        >
          <Plus className="h-6 w-6" />
        </Link>
      </div>
    </section>
  )
}
