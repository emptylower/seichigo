'use client'

import { ArrowRight, LocateFixed, Navigation } from 'lucide-react'
import type { PointPreview, PointRecord, RouteBookStatus } from '../types'
import { RoutePreviewMap } from './RoutePreviewMap'

interface PlannerMapStageProps {
  status: RouteBookStatus
  sortedCount: number
  checkedCount: number
  allDone: boolean
  routePoints: Array<{ lat: number; lng: number; label: string }>
  routeGeometry: { type: 'LineString'; coordinates: [number, number][] } | null
  hasRouteStops: boolean
  focusPreview: PointPreview | null
  nextPoint: PointRecord | null
  nextPreview: PointPreview | null
  onCheckIn: (pointId: string) => void
  onMarkComplete: () => void
  onPrimaryAction: () => void
  primaryActionLabel: string
  primaryActionDisabled?: boolean
  compact?: boolean
}

export function PlannerMapStage({
  status,
  sortedCount,
  checkedCount,
  allDone,
  routePoints,
  routeGeometry,
  hasRouteStops,
  focusPreview,
  nextPoint,
  nextPreview,
  onCheckIn,
  onMarkComplete,
  onPrimaryAction,
  primaryActionLabel,
  primaryActionDisabled = false,
  compact = false,
}: PlannerMapStageProps) {
  const progressRatio = sortedCount > 0 ? Math.min(100, Math.round((checkedCount / sortedCount) * 100)) : 0

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[32px] border border-pink-100/90 bg-white/95 p-4 shadow-[0_24px_44px_-34px_rgba(15,23,42,0.38)]">
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-50 text-brand-600">
            <Navigation className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">路线预览</h2>
            <p className="text-xs text-slate-500">
              {sortedCount > 0 ? `${sortedCount} 个点位，已打卡 ${checkedCount} 个` : '加入点位后自动生成路线预览'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full border border-pink-100 bg-pink-50/60 px-3 py-1 text-xs font-semibold text-brand-600">
            {hasRouteStops ? '路线预览' : '单点预览'}
          </span>
          {nextPreview ? (
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              下一站：{nextPreview.title}
            </span>
          ) : null}
        </div>
      </div>

      <div className={`relative overflow-hidden rounded-[28px] border border-pink-100/80 bg-slate-100 ${compact ? 'min-h-[17rem]' : 'min-h-0 flex-1'}`}>
        {routePoints.length > 0 ? (
          <RoutePreviewMap
            points={routePoints}
            routeGeometry={routeGeometry}
            className="absolute inset-0 h-full w-full"
            compact={compact}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_top,#fff1f7,transparent_55%),linear-gradient(180deg,#f8fafc,#fdf2f8)] px-8 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-brand-500 shadow-sm">
              <Navigation className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900">路线预览会出现在这里</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
              先从点位池把候选圣地加入路线，系统会实时更新地图和导航顺序。
            </p>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(15,23,42,0.34),rgba(15,23,42,0))]" />
        <div className="absolute left-4 top-4 right-4 flex items-start justify-between gap-3">
          <div className="rounded-full border border-white/50 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-sm">
            {sortedCount > 0 ? `${sortedCount} 个点位` : '等待点位'}
          </div>
          <div className="rounded-full border border-white/50 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur-sm">
            进度 {checkedCount}/{sortedCount || 0}
          </div>
        </div>

        {focusPreview ? (
          <div className="absolute bottom-4 left-4 max-w-[18rem] rounded-[20px] border border-white/55 bg-white/90 p-3 shadow-[0_20px_30px_-22px_rgba(15,23,42,0.45)] backdrop-blur-sm">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-brand-600">
              <LocateFixed className="h-3.5 w-3.5" />
              {status === 'completed' ? '路线回顾' : nextPreview ? '下一站' : '当前聚焦点'}
            </div>
            <h3 className="mt-2 line-clamp-1 text-sm font-semibold text-slate-900 sm:text-[15px]">
              {(nextPreview || focusPreview).title}
            </h3>
            <p className="mt-1 line-clamp-1 text-xs text-slate-500">{(nextPreview || focusPreview).subtitle}</p>
            {sortedCount > 0 ? (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${progressRatio}%` }} />
              </div>
            ) : null}
            {sortedCount > 0 ? (
              <div className="mt-2 text-xs text-slate-500">
                进度 {checkedCount}/{sortedCount}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-pink-100/80 bg-pink-50/30 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
            {allDone ? '已全部完成' : status === 'in_progress' ? '巡礼进行中' : '待开始'}
          </span>
          <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">
            进度 {checkedCount}/{sortedCount || 0}
          </span>
          {nextPreview ? (
            <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">
              下一站 {nextPreview.title}
            </span>
          ) : null}
          <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">
            开始导航后进入站内巡礼模式
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {nextPoint && !allDone ? (
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-white transition hover:bg-emerald-600"
              onClick={() => onCheckIn(nextPoint.pointId)}
            >
              打卡下一站
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}
          {sortedCount > 0 && (allDone || status === 'in_progress') ? (
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={onMarkComplete}
            >
              {allDone ? '标记全部完成' : '结束本次巡礼'}
            </button>
          ) : null}
        </div>
      </div>

      {!compact ? (
        <div className="mt-4">
          <button
            type="button"
            disabled={primaryActionDisabled}
            className="inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-[24px] bg-brand-400 px-6 text-lg font-semibold text-white shadow-[0_18px_34px_-22px_rgba(225,29,72,0.7)] transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={onPrimaryAction}
          >
            <Navigation className="h-5 w-5" />
            {primaryActionLabel}
          </button>
        </div>
      ) : null}
    </section>
  )
}
