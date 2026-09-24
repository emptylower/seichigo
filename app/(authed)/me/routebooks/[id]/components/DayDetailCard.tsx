'use client'

import { useState } from 'react'
import { BedDouble, ChevronDown, ChevronUp } from 'lucide-react'
import type { DayRecord, LodgingRecord, PlaceRecord } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { tr } from '../../i18n'
import type { WeatherDay } from '../hooks/useWeather'
import { WeatherBadge } from './WeatherBadge'

type Props = {
  day: DayRecord | null
  lodgings: LodgingRecord[]
  places: PlaceRecord[]
  onEditLodging?: (lodgingId: string) => void
  /** B4：当天天气 */
  weather?: WeatherDay | null
  locale?: SupportedLocale
}

/** 与这一天相关的住宿区间（入住日/住中/退房日都相关；from==to 当天锚也算） */
export function lodgingsForDay(lodgings: LodgingRecord[], dayIndex: number): LodgingRecord[] {
  return lodgings.filter((row) => row.fromDayIndex <= dayIndex && dayIndex <= row.toDayIndex)
}

/** 地图右上可折叠浮卡：当天天气 + 住宿信息 */
export function DayDetailCard({ day, lodgings, places, onEditLodging, weather = null, locale = 'zh' }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  if (!day) return null
  const relevant = lodgingsForDay(lodgings, day.dayIndex)
  if (relevant.length === 0 && !weather) return null

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-10 w-56 rounded-2xl border border-pink-100/90 bg-white/95 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-label={collapsed ? tr('routebook.dayDetail.expand', locale) : tr('routebook.dayDetail.collapse', locale)}
      >
        {relevant.length > 0 ? <BedDouble className="h-4 w-4 shrink-0 text-brand-500" /> : null}
        <span className="flex-1 text-xs font-semibold text-slate-800">
          {relevant.length > 0 ? tr('routebook.dayDetail.lodgingTitle', locale) : tr('routebook.weather.title', locale)}
        </span>
        {weather ? <WeatherBadge weather={weather} locale={locale} /> : null}
        {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronUp className="h-3.5 w-3.5 text-slate-400" />}
      </button>
      {collapsed || relevant.length === 0 ? null : (
        <div className="space-y-1.5 px-3 pb-2.5">
          {relevant.map((lodging) => {
            const place = places.find((row) => row.id === lodging.placeId)
            const badgeKey =
              lodging.fromDayIndex === day.dayIndex
                ? 'badgeCheckIn'
                : lodging.toDayIndex === day.dayIndex
                  ? 'badgeCheckOut'
                  : 'badgeStaying'
            return (
              <button
                key={lodging.id}
                type="button"
                disabled={!onEditLodging}
                className="block w-full rounded-xl bg-pink-50/60 px-2.5 py-1.5 text-left transition hover:bg-pink-50 disabled:cursor-default"
                onClick={() => onEditLodging?.(lodging.id)}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      badgeKey === 'badgeCheckIn'
                        ? 'bg-emerald-100 text-emerald-700'
                        : badgeKey === 'badgeCheckOut'
                          ? 'bg-rose-100 text-rose-600'
                          : 'bg-slate-200/80 text-slate-500'
                    }`}
                  >
                    {tr(`routebook.lodging.${badgeKey}`, locale)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">
                    {place?.title ?? tr('routebook.common.placeFallback', locale)}
                  </span>
                </span>
                {lodging.checkIn || lodging.checkOut ? (
                  <span className="mt-0.5 block text-[10px] text-slate-400">
                    {lodging.checkIn ?? '--:--'} – {lodging.checkOut ?? '--:--'}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
