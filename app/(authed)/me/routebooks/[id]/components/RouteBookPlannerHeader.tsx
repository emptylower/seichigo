'use client'
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
    <section className="rounded-[28px] border border-pink-100/90 bg-white/92 p-4 shadow-[0_20px_40px_-34px_rgba(15,23,42,0.35)] sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="max-w-xl">
            <RouteBookSelector items={routeBooks} currentId={routeBook.id} />
          </div>

          {editingTitle ? (
            <div className="flex flex-col gap-2 sm:flex-row">
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
              <button
                type="button"
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-brand-500 px-5 text-sm font-semibold text-white transition hover:bg-brand-600"
                onClick={() => void onTitleSave()}
              >
                保存标题
              </button>
              <button
                type="button"
                className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => setEditingTitle(false)}
              >
                取消
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <button
                type="button"
                className="min-w-0 text-left"
                onClick={() => setEditingTitle(true)}
                title="点击编辑标题"
              >
                <h1 className="line-clamp-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-[30px]">{routeBook.title}</h1>
              </button>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[routeBook.status]}`}>
                  {STATUS_LABEL[routeBook.status]}
                </span>
                <span className="inline-flex rounded-full border border-pink-100 bg-pink-50/50 px-3 py-1 text-xs font-medium text-slate-600">
                  {sortedCount} 个点位
                </span>
                <span className="inline-flex rounded-full border border-pink-100 bg-pink-50/50 px-3 py-1 text-xs font-medium text-slate-600">
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
            </div>
          )}

          <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-[15px]">{description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
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
      </div>
    </section>
  )
}
