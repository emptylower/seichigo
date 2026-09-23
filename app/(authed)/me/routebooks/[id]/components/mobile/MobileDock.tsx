'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Layers, MoreHorizontal, Navigation, Play, Sparkles, X } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { NavTarget } from '@/lib/route/navigationTargets'
import { OpenInMapsSheet } from '@/components/navigation/OpenInMapsMenu'
import type { DayRecord, TravelMode } from '../../types'
import { buildExportEntries, ExportOptions } from '../ExportMenu'
import { tr } from '../../../i18n'

type Props = {
  /** 当前选中天；null（全部/未安排）时优化与导航禁用 */
  selectedDay: DayRecord | null
  /** 当前天可移动点数（有坐标、非锚的 point/place）；< 2 时优化禁用 */
  movableCount: number
  /** 当天三家导航目标（Google / Apple / 高德）；空数组禁用 */
  navTargets: NavTarget[]
  /** 「更多」里的导出入口 */
  routeBookId: string
  /** 选中天（GPX 当天）；null 不给当天项 */
  selectedDayIndex: number | null
  /** 行程有日期才能导出 ICS */
  hasDates: boolean
  canStart: boolean
  startLabel: string
  /** true = 点「开始」先弹选天 sheet（无日期或未选天） */
  needsDayPick: boolean
  onOpenPool: () => void
  onOptimize: () => void
  onOpenDayPicker: () => void
  onStart: () => void
  /** 导航 action sheet 内切换当天默认交通方式（调 updateDay） */
  onChangeTravelMode?: (mode: TravelMode) => void
  locale?: SupportedLocale
}

const TRAVEL_MODES: TravelMode[] = ['transit', 'walking', 'driving']

/** 移动端固定底部 dock：点位池 / 优化 / 打开导航 / 开始 Day N / 更多（导出） */
export function MobileDock({
  selectedDay,
  movableCount,
  navTargets,
  routeBookId,
  selectedDayIndex,
  hasDates,
  canStart,
  startLabel,
  needsDayPick,
  onOpenPool,
  onOptimize,
  onOpenDayPicker,
  onStart,
  onChangeTravelMode,
  locale = 'zh',
}: Props) {
  const [navSheetOpen, setNavSheetOpen] = useState(false)
  const [moreSheetOpen, setMoreSheetOpen] = useState(false)

  const optimizeDisabled = !selectedDay || movableCount < 2
  const optimizeTitle = !selectedDay
    ? tr('routebook.mobile.optimizeNeedDay', locale)
    : movableCount < 2
      ? tr('routebook.mobile.optimizeNeedPoints', locale)
      : undefined
  const navDisabled = navTargets.length === 0

  return (
    <>
      <nav
        aria-label={tr('routebook.mobile.dockLabel', locale)}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-pink-100/80 bg-white/95 backdrop-blur-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1 px-3 pt-2">
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
                ? tr('routebook.mobile.disabledWithReason', locale, {
                    label: tr('routebook.mobile.dockOptimize', locale),
                    reason: optimizeTitle ?? '',
                  })
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
            <span className="max-w-full truncate">{startLabel}</span>
          </button>
          <button
            type="button"
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium text-slate-600 transition hover:bg-pink-50 hover:text-brand-600"
            onClick={() => setMoreSheetOpen(true)}
          >
            <MoreHorizontal className="h-5 w-5" />
            {tr('routebook.export.more', locale)}
          </button>
        </div>
        {/* 底部留白给安全区外的内容间距 */}
        <div className="h-2" />
      </nav>

      {navSheetOpen && navTargets.length > 0 ? (
        <OpenInMapsSheet targets={navTargets} locale={locale} onClose={() => setNavSheetOpen(false)}>
          {selectedDay && onChangeTravelMode ? (
            <div
              role="radiogroup"
              aria-label={tr('routebook.mobile.travelModeLabel', locale)}
              className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-pink-50/80 p-1"
            >
              {TRAVEL_MODES.map((mode) => {
                const active = selectedDay.defaultTravelMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`min-h-10 rounded-xl text-xs font-semibold transition ${
                      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                    onClick={() => {
                      if (!active) onChangeTravelMode(mode)
                    }}
                  >
                    {tr(`routebook.travelMode.${mode}`, locale)}
                  </button>
                )
              })}
            </div>
          ) : null}
        </OpenInMapsSheet>
      ) : null}

      {moreSheetOpen
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-end justify-center">
              <button
                type="button"
                aria-label={tr('routebook.common.close', locale)}
                className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
                onClick={() => setMoreSheetOpen(false)}
              />
              <div
                role="dialog"
                aria-label={tr('routebook.export.menuLabel', locale)}
                className="relative mb-0 w-full max-w-md rounded-t-[28px] border border-pink-100 bg-white p-4 shadow-[0_-18px_44px_-24px_rgba(15,23,42,0.45)]"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <h3 className="text-base font-semibold text-slate-900">{tr('routebook.export.menuLabel', locale)}</h3>
                  <button
                    type="button"
                    aria-label={tr('routebook.common.close', locale)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
                    onClick={() => setMoreSheetOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <ExportOptions
                  entries={buildExportEntries(routeBookId, selectedDayIndex, hasDates, locale)}
                  onPicked={() => setMoreSheetOpen(false)}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
