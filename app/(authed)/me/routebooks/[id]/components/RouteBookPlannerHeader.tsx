'use client'

import { Clock3, MapPinned, Route, Sparkles } from 'lucide-react'
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
    <section className="relative overflow-hidden rounded-[32px] border border-pink-100/90 bg-[linear-gradient(160deg,rgba(255,255,255,0.98),rgba(253,242,248,0.88))] p-4 shadow-[0_30px_60px_-40px_rgba(219,39,119,0.45)] sm:p-5">
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,#e11d48_1px,transparent_1px),linear-gradient(to_bottom,#e11d48_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="pointer-events-none absolute -left-12 top-8 h-28 w-28 rounded-full bg-brand-100/70 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-36 w-36 rounded-full bg-cyan-100/75 blur-3xl" />

      <div className="relative space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="max-w-xl">
              <RouteBookSelector items={routeBooks} currentId={routeBook.id} />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[routeBook.status]}`}>
                  {STATUS_LABEL[routeBook.status]}
                </span>
                {metadata.city ? (
                  <span className="inline-flex rounded-full border border-pink-100 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600">
                    {metadata.city}
                  </span>
                ) : null}
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
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setEditingTitle(true)}
                  title="点击编辑标题"
                >
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[30px]">{routeBook.title}</h1>
                </button>
              )}

              <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-[15px]">{description}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[22rem]">
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Route className="h-3.5 w-3.5 text-brand-500" />
                路线
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{sortedCount}</div>
              <div className="text-xs text-slate-500">当前排序点位</div>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Sparkles className="h-3.5 w-3.5 text-brand-500" />
                打卡
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{checkedCount}</div>
              <div className="text-xs text-slate-500">已完成站点</div>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <MapPinned className="h-3.5 w-3.5 text-brand-500" />
                地图
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{routeBooks.length || 1}</div>
              <div className="text-xs text-slate-500">已创建地图</div>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/85 p-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Clock3 className="h-3.5 w-3.5 text-brand-500" />
                更新
              </div>
              <div className="mt-2 text-base font-semibold text-slate-900">{formatDate(routeBook.updatedAt)}</div>
              <div className="text-xs text-slate-500">最近一次调整</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {routeBook.status === 'in_progress' ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
              onClick={() => void onStatusChange('completed')}
            >
              标记本次巡礼完成
            </button>
          ) : null}
          {routeBook.status === 'completed' ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => void onStatusChange('draft')}
            >
              重新编辑路线
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
