'use client'

import type { RouteBookDetail, RouteBookStatus } from '../types'
import { STATUS_LABEL, STATUS_STYLE, STATUS_ACTION_CLASS } from '../types'
import { formatDate } from '../utils'

interface RouteBookHeaderProps {
  routeBook: RouteBookDetail
  editingTitle: boolean
  titleDraft: string
  setTitleDraft: (v: string) => void
  setEditingTitle: (v: boolean) => void
  onTitleSave: () => void
  onStatusChange: (status: RouteBookStatus) => Promise<void>
  onStartPilgrimage: () => void
}

export function RouteBookHeader({
  routeBook,
  editingTitle,
  titleDraft,
  setTitleDraft,
  setEditingTitle,
  onTitleSave,
  onStatusChange,
  onStartPilgrimage,
}: RouteBookHeaderProps) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-pink-100/90 bg-[linear-gradient(150deg,rgba(255,255,255,0.95),rgba(253,242,248,0.88))] p-5 shadow-[0_22px_45px_-30px_rgba(219,39,119,0.45)] sm:p-6">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-cyan-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-0 h-40 w-40 rounded-full bg-brand-200/50 blur-3xl" />

      <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          {editingTitle ? (
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                maxLength={100}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-lg font-semibold focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:max-w-xl"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onTitleSave()
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
              />
              <button
                type="button"
                className="w-full rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 sm:w-auto"
                onClick={() => void onTitleSave()}
              >
                保存
              </button>
              <button
                type="button"
                className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 sm:w-auto"
                onClick={() => setEditingTitle(false)}
              >
                取消
              </button>
            </div>
          ) : (
            <h1
              className="cursor-pointer text-xl font-bold text-slate-900 transition hover:text-brand-600 sm:text-2xl"
              onClick={() => setEditingTitle(true)}
              title="点击编辑标题"
            >
              {routeBook.title}
            </h1>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:text-sm">
            <span className={`inline-flex rounded-full border border-white/50 px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${STATUS_STYLE[routeBook.status]}`}>
              {STATUS_LABEL[routeBook.status]}
            </span>
            <span>更新于 {formatDate(routeBook.updatedAt)}</span>
          </div>
        </div>

        <a
          href="/me/routebooks"
          className="inline-flex min-h-10 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 no-underline transition hover:bg-slate-50 sm:w-auto"
        >
          返回列表
        </a>
      </div>

      <div className="relative mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {routeBook.status === 'draft' && (
          <button
            type="button"
            className={`w-full rounded-full px-4 py-2 text-sm font-semibold transition sm:w-auto ${STATUS_ACTION_CLASS.draft}`}
            onClick={onStartPilgrimage}
          >
            开始巡礼
          </button>
        )}
        {routeBook.status === 'in_progress' && (
          <>
            <button
              type="button"
              className={`w-full rounded-full px-4 py-2 text-sm font-semibold transition sm:w-auto ${STATUS_ACTION_CLASS.in_progress}`}
              onClick={() => void onStatusChange('completed')}
            >
              完成巡礼
            </button>
            <button
              type="button"
              className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50 sm:w-auto"
              onClick={() => void onStatusChange('draft')}
            >
              回到草稿
            </button>
          </>
        )}
        {routeBook.status === 'completed' && (
          <button
            type="button"
            className={`w-full rounded-full px-4 py-2 text-sm font-semibold transition sm:w-auto ${STATUS_ACTION_CLASS.completed}`}
            onClick={() => void onStatusChange('draft')}
          >
            重新编辑
          </button>
        )}
      </div>
    </section>
  )
}
