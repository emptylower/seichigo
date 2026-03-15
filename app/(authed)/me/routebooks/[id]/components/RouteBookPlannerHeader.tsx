'use client'

import Link from 'next/link'
import { Plus, Sparkles } from 'lucide-react'
import type { RouteBookDetail, RouteBookStatus, RouteBookSummary } from '../types'
import { STATUS_LABEL, STATUS_STYLE } from '../types'
import { formatDate } from '../utils'
import { RouteBookSelector } from './RouteBookSelector'

type RouteBookMetadata = {
  description?: string
  city?: string
}

const STATUS_SUMMARY: Record<RouteBookStatus, string> = {
  draft: '先把想去点位收进地图，再调整成今天可执行的路线。',
  in_progress: '路线已经开始巡礼，可以按当前顺序继续导航与打卡。',
  completed: '这张地图已经完成，可以回看路线或重新编辑下一次版本。',
}

function parseMetadata(input: unknown): RouteBookMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const row = input as Record<string, unknown>
  return {
    description: typeof row.description === 'string' ? row.description : undefined,
    city: typeof row.city === 'string' ? row.city : undefined,
  }
}

interface RouteBookPlannerHeaderProps {
  routeBook: RouteBookDetail
  routeBooks: RouteBookSummary[]
  sortedCount: number
  checkedCount: number
  editingTitle: boolean
  titleDraft: string
  setTitleDraft: (value: string) => void
  setEditingTitle: (value: boolean) => void
  onTitleSave: () => void
  onStatusChange: (status: RouteBookStatus) => Promise<void>
}

export function RouteBookPlannerHeader({
  routeBook,
  routeBooks,
  sortedCount,
  checkedCount,
  editingTitle,
  titleDraft,
  setTitleDraft,
  setEditingTitle,
  onTitleSave,
  onStatusChange,
}: RouteBookPlannerHeaderProps) {
  const metadata = parseMetadata(routeBook.metadata)
  const description = metadata.description || STATUS_SUMMARY[routeBook.status]

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <RouteBookSelector items={routeBooks} currentId={routeBook.id} />
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

      <article className="rounded-[30px] border border-pink-100/90 bg-white/95 p-5 shadow-[0_22px_42px_-34px_rgba(15,23,42,0.34)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[routeBook.status]}`}>
            {STATUS_LABEL[routeBook.status]}
          </span>
          <span className="inline-flex rounded-full border border-pink-100 bg-pink-50/60 px-3 py-1 text-xs font-medium text-slate-600">
            {sortedCount} 个点位
          </span>
          <span className="inline-flex rounded-full border border-pink-100 bg-pink-50/60 px-3 py-1 text-xs font-medium text-slate-600">
            已打卡 {checkedCount}
          </span>
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            更新于 {formatDate(routeBook.updatedAt)}
          </span>
          {metadata.city ? (
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              {metadata.city}
            </span>
          ) : null}
        </div>

        {editingTitle ? (
          <div className="mt-4 space-y-3">
            <input
              type="text"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              maxLength={100}
              className="w-full rounded-2xl border border-pink-200 bg-white px-4 py-3 text-lg font-semibold text-slate-900 outline-none ring-0 transition focus:border-brand-400"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void onTitleSave()
                if (event.key === 'Escape') setEditingTitle(false)
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600"
                onClick={() => void onTitleSave()}
              >
                保存标题
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => setEditingTitle(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <button type="button" className="w-full text-left" onClick={() => setEditingTitle(true)} title="点击编辑标题">
              <div className="text-base font-semibold text-slate-900">{routeBook.title}</div>
            </button>
            <p className="mt-2 text-sm leading-7 text-slate-500">{description}</p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {routeBook.status === 'in_progress' ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
              onClick={() => void onStatusChange('completed')}
            >
              标记巡礼完成
            </button>
          ) : null}
          {routeBook.status === 'completed' ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => void onStatusChange('draft')}
            >
              重新编辑
            </button>
          ) : null}
        </div>
      </article>
    </section>
  )
}
