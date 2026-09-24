'use client'

import { useEffect, useRef } from 'react'
import { Inbox } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayRecord } from '../../types'
import { dayLabel } from '../../utils'
import { tr } from '../../../i18n'
import { weatherForDay, type WeatherByDate } from '../../hooks/useWeather'
import { WeatherBadge } from '../WeatherBadge'

type Props = {
  days: DayRecord[]
  /** null = 全部（与桌面语义一致：全览不画线） */
  selectedDayId: string | null
  /** 「未安排」胶囊选中态（selectedDayId 之外的正交状态，只影响计划视图） */
  unassignedSelected: boolean
  unassignedCount: number
  onSelectDay: (dayId: string) => void
  onShowAll: () => void
  onShowUnassigned: () => void
  /** B4：胶囊上的小天气 emoji（可选） */
  weatherByDate?: WeatherByDate
  locale?: SupportedLocale
}

const PILL_BASE =
  'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition'
const PILL_ACTIVE = 'border-brand-500 bg-brand-500 text-white'
const PILL_IDLE = 'border-pink-100 bg-white text-slate-600'

/** 移动端顶部横向天胶囊轨道：「全部」+ Day 1…N +「未安排」；选中项自动滚入视野 */
export function DayPillTrack({
  days,
  selectedDayId,
  unassignedSelected,
  unassignedCount,
  onSelectDay,
  onShowAll,
  onShowUnassigned,
  weatherByDate,
  locale = 'zh',
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)

  // 选中变化时把当前胶囊滚入视野（横向居中，纵向不动）
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const current = track.querySelector<HTMLElement>('[data-active="true"]')
    current?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [selectedDayId, unassignedSelected])

  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  const allActive = selectedDayId === null && !unassignedSelected

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={tr('routebook.mobile.pillsLabel', locale)}
      className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        type="button"
        role="tab"
        aria-selected={allActive}
        data-active={allActive}
        className={`${PILL_BASE} ${allActive ? PILL_ACTIVE : PILL_IDLE}`}
        onClick={onShowAll}
      >
        {tr('routebook.detail.tabAll', locale)}
      </button>
      {sorted.map((day) => {
        const active = day.id === selectedDayId && !unassignedSelected
        const weather = weatherByDate ? weatherForDay(weatherByDate, day) : null
        return (
          <button
            key={day.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            className={`${PILL_BASE} ${active ? PILL_ACTIVE : PILL_IDLE}`}
            onClick={() => onSelectDay(day.id)}
          >
            {dayLabel(day, day.dayIndex, locale)}
            {weather ? <WeatherBadge weather={weather} locale={locale} compact className="text-sm" /> : null}
          </button>
        )
      })}
      <button
        type="button"
        role="tab"
        aria-selected={unassignedSelected}
        data-active={unassignedSelected}
        className={`${PILL_BASE} ${unassignedSelected ? PILL_ACTIVE : PILL_IDLE}`}
        onClick={onShowUnassigned}
      >
        <Inbox className="h-3.5 w-3.5" />
        {tr('routebook.common.unassigned', locale)}
        {unassignedCount > 0 ? (
          <span
            className={`inline-flex min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
              unassignedSelected ? 'bg-white/25 text-white' : 'bg-pink-100 text-brand-600'
            }`}
          >
            {unassignedCount}
          </span>
        ) : null}
      </button>
    </div>
  )
}
