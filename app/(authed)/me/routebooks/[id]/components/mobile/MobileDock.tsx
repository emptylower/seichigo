'use client'

import { useState } from 'react'
import { Layers, Navigation, Play, Sparkles, X } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayRecord } from '../../types'
import { tr } from '../../../i18n'

type Props = {
  /** 当前选中天；null（全部/未安排）时优化与导航禁用 */
  selectedDay: DayRecord | null
  /** 当前天可移动点数（有坐标、非锚的 point/place）；< 2 时优化禁用 */
  movableCount: number
  /** 打开导航的 URL（B4 前只有 Google）；null 禁用 */
  navUrl: string | null
  canStart: boolean
  startLabel: string
  /** true = 点「开始」先弹选天 sheet（无日期或未选天） */
  needsDayPick: boolean
  onOpenPool: () => void
  onOptimize: () => void
  onOpenDayPicker: () => void
  onStart: () => void
  locale?: SupportedLocale
}

/** 移动端固定底部 dock：点位池 / 优化 / 打开导航 / 开始 Day N */
export function MobileDock({
  selectedDay,
  movableCount,
  navUrl,
  canStart,
  startLabel,
  needsDayPick,
  onOpenPool,
  onOptimize,
  onOpenDayPicker,
  onStart,
  locale = 'zh',
}: Props) {
  const [navSheetOpen, setNavSheetOpen] = useState(false)

  const optimizeDisabled = !selectedDay || movableCount < 2
  const optimizeTitle = !selectedDay
    ? tr('routebook.mobile.optimizeNeedDay', locale)
    : movableCount < 2
      ? tr('routebook.mobile.optimizeNeedPoints', locale)
      : undefined
  const navDisabled = !navUrl

  return (
    <>
      <nav
        aria-label="planner dock"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-pink-100/80 bg-white/95 backdrop-blur-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1 px-3 pt-2">
          <button
            type="button"
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium text-slate-600 transition hover:bg-pink-50 hover:text-brand-600"
            onClick={onOpenPool}
          >
            <Layers className="h-5 w-5" />
            {tr('routebook.mobile.dockPool', locale)}
          </button>
          <button
            type="button"
            disabled={optimizeDisabled}
            title={optimizeTitle}
            aria-label={
              optimizeDisabled
                ? `${tr('routebook.mobile.dockOptimize', locale)}（${optimizeTitle ?? ''}）`
                : tr('routebook.mobile.dockOptimize', locale)
            }
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium text-slate-600 transition hover:bg-pink-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onOptimize}
          >
            <Sparkles className="h-5 w-5" />
            {tr('routebook.mobile.dockOptimize', locale)}
          </button>
          <button
            type="button"
            disabled={navDisabled}
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium text-slate-600 transition hover:bg-pink-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setNavSheetOpen(true)}
          >
            <Navigation className="h-5 w-5" />
            {tr('routebook.mobile.dockNav', locale)}
          </button>
          <button
            type="button"
            disabled={!canStart}
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-300"
            onClick={() => {
              if (needsDayPick) {
                onOpenDayPicker()
                return
              }
              onStart()
            }}
          >
            <Play className="h-5 w-5" />
            {startLabel}
          </button>
        </div>
        {/* 底部留白给安全区外的内容间距 */}
        <div className="h-2" />
      </nav>

      {navSheetOpen && navUrl ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center">
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setNavSheetOpen(false)}
          />
          <div
            className="relative mb-0 w-full max-w-md rounded-t-[28px] border border-pink-100 bg-white p-4 shadow-[0_-18px_44px_-24px_rgba(15,23,42,0.45)]"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <h3 className="text-base font-semibold text-slate-900">{tr('routebook.mobile.navSheetTitle', locale)}</h3>
              <button
                type="button"
                aria-label={tr('routebook.common.close', locale)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
                onClick={() => setNavSheetOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <a
              href={navUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center gap-3 rounded-2xl border border-pink-100/80 bg-white px-4 py-3 text-left no-underline transition hover:border-brand-200 hover:bg-pink-50/60"
              onClick={() => setNavSheetOpen(false)}
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-brand-500">
                <Navigation className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
                {tr('routebook.mobile.navGoogle', locale)}
              </span>
            </a>
          </div>
        </div>
      ) : null}
    </>
  )
}
