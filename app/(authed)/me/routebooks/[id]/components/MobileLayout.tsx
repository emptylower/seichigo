'use client'

import { useState, type ReactNode } from 'react'
import { Navigation, Plus } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayRecord } from '../types'
import { dayLabel } from '../utils'
import { tr } from '../../i18n'

type Props = {
  header: ReactNode
  days: DayRecord[]
  selectedDay: DayRecord | null
  selectedDayId: string | null
  onSelectDay: (dayId: string) => void
  onShowAll: () => void
  mapStage: ReactNode
  dayBlock: ReactNode
  poolPanel: ReactNode
  onOpenPoolSheet: () => void
  canStart: boolean
  startLabel: string
  onStartImmersive: () => void
  locale: SupportedLocale
}

/** 移动端编排：行程本选择器 + 天 chips + 「路线 / 点位池」两 tab + 底部固定「开始」按钮 */
export function MobileLayout({
  header,
  days,
  selectedDay,
  selectedDayId,
  onSelectDay,
  onShowAll,
  mapStage,
  dayBlock,
  poolPanel,
  onOpenPoolSheet,
  canStart,
  startLabel,
  onStartImmersive,
  locale,
}: Props) {
  const [mobileTab, setMobileTab] = useState<'route' | 'pool'>('route')

  return (
    <>
      <section className="space-y-4">
        {header}

        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            className={`inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition ${
              selectedDayId === null
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-pink-100 bg-white text-slate-600'
            }`}
            onClick={onShowAll}
          >
            {tr('routebook.detail.tabAll', locale)}
          </button>
          {days.map((day) => {
            const active = day.id === selectedDayId
            return (
              <button
                key={day.id}
                type="button"
                className={`inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition ${
                  active ? 'border-brand-500 bg-brand-500 text-white' : 'border-pink-100 bg-white text-slate-600'
                }`}
                onClick={() => onSelectDay(day.id)}
              >
                {dayLabel(day, day.dayIndex, locale)}
              </button>
            )
          })}
        </div>

        <div className="inline-flex w-full rounded-[26px] bg-pink-50/80 p-1">
          {([
            ['route', selectedDay
              ? tr('routebook.detail.tabRouteDay', locale, { n: selectedDay.dayIndex })
              : tr('routebook.detail.tabRoute', locale)],
            ['pool', tr('routebook.detail.tabPool', locale)],
          ] as const).map(([key, label]) => {
            const active = mobileTab === key
            return (
              <button
                key={key}
                type="button"
                className={`inline-flex min-h-12 flex-1 items-center justify-center rounded-[22px] px-3 text-sm font-semibold transition ${
                  active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
                onClick={() => setMobileTab(key)}
              >
                {label}
              </button>
            )
          })}
        </div>

        {mobileTab === 'route' ? (
          <div className="space-y-4">
            {mapStage}
            {dayBlock}
            <button
              type="button"
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[24px] border border-brand-200 bg-white text-sm font-semibold text-brand-600 shadow-sm transition hover:bg-brand-50"
              onClick={onOpenPoolSheet}
            >
              <Plus className="h-4 w-4" />
              {tr('routebook.detail.addFromPool', locale)}
            </button>
          </div>
        ) : (
          poolPanel
        )}
      </section>

      {canStart ? (
        <div className="fixed inset-x-4 bottom-4 z-40">
          <button
            type="button"
            className="inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-[26px] bg-brand-400 px-6 text-lg font-semibold text-white shadow-[0_18px_34px_-22px_rgba(225,29,72,0.7)] transition hover:bg-brand-500"
            onClick={onStartImmersive}
          >
            <Navigation className="h-5 w-5" />
            {startLabel}
          </button>
        </div>
      ) : null}
    </>
  )
}
