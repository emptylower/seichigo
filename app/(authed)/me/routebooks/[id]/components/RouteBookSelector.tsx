'use client'

import Link from 'next/link'
import { Check, ChevronDown, MapPinned, Plus } from 'lucide-react'
import type { RouteBookSummary } from '../types'
import { STATUS_LABEL, STATUS_STYLE } from '../types'
import { formatDate } from '../utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface RouteBookSelectorProps {
  items: RouteBookSummary[]
  currentId: string
}

export function RouteBookSelector({ items, currentId }: RouteBookSelectorProps) {
  const current = items.find((item) => item.id === currentId) || null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-14 w-full items-center justify-between gap-3 rounded-[24px] border border-pink-100/90 bg-white px-4 py-3 text-left shadow-[0_18px_40px_-32px_rgba(219,39,119,0.35)] transition hover:border-pink-200 hover:bg-pink-50/40"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <MapPinned className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-slate-900">
                {current?.title || '选择地图'}
              </span>
              <span className="block text-xs text-slate-500">
                {current ? `更新于 ${formatDate(current.updatedAt)}` : '切换当前规划地图'}
              </span>
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] rounded-3xl border-pink-100/90 bg-white p-2 shadow-[0_28px_60px_-34px_rgba(15,23,42,0.45)]"
      >
        {items.map((item) => {
          const active = item.id === currentId
          return (
            <DropdownMenuItem
              key={item.id}
              asChild
              className={`rounded-2xl px-3 py-3 ${active ? 'bg-pink-50/80 focus:bg-pink-50/80' : ''}`}
            >
              <Link href={`/me/routebooks/${item.id}`} prefetch={false} className="flex items-center gap-3 no-underline">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  {active ? <Check className="h-4 w-4 text-brand-600" /> : <MapPinned className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm font-semibold text-slate-900">{item.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                    <span>更新于 {formatDate(item.updatedAt)}</span>
                  </span>
                </span>
              </Link>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator className="bg-pink-100/80" />
        <DropdownMenuItem asChild className="rounded-2xl px-3 py-3">
          <Link href="/me/routebooks" prefetch={false} className="flex items-center gap-3 font-medium text-slate-700 no-underline">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <Plus className="h-4 w-4" />
            </span>
            去地图列表新建或管理
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
