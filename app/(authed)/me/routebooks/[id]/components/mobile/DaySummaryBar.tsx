'use client'

import { useMemo, useState } from 'react'
import { BedDouble, ChevronRight, X } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { DayLegsResult, DayRecord, ItemRecord, LodgingRecord, PlaceRecord } from '../../types'
import { toIntlLocale } from '@/lib/i18n/intlLocale'
import { lodgingsForDay } from '../DayDetailCard'
import { tr } from '../../../i18n'

const STOP_MINUTES_ESTIMATE = 40

type Props = {
  day: DayRecord
  items: ItemRecord[]
  places: PlaceRecord[]
  lodgings: LodgingRecord[]
  legs?: DayLegsResult
  onEditLodging?: (lodgingId: string) => void
  locale?: SupportedLocale
}

/** 「M/D 周X」日期片段（与 dayLabel 的日期部分一致；无日期返回 null） */
export function dayDateLabel(day: Pick<DayRecord, 'date'>, locale: SupportedLocale = 'zh'): string | null {
  if (!day.date) return null
  const parsed = new Date(day.date)
  if (Number.isNaN(parsed.getTime())) return null
  const intl = toIntlLocale(locale)
  const weekday = new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' }).format(parsed)
  if (locale === 'en') {
    return `${new Intl.DateTimeFormat(intl, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)}, ${weekday}`
  }
  const md = `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`
  return locale === 'ja' ? `${md}(${weekday})` : `${md} ${weekday}`
}

/** 天标题下一行摘要：日期 · 住宿 ·「N 站 · 约 X 小时」；点开 = 住宿详情底部抽屉 */
export function DaySummaryBar({ day, items, places, lodgings, legs, onEditLodging, locale = 'zh' }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const relevant = lodgingsForDay(lodgings, day.dayIndex)
  const lodgingNames = relevant
    .map((row) => places.find((place) => place.id === row.placeId)?.title)
    .filter((title): title is string => Boolean(title))

  const { stopCount, totalHours } = useMemo(() => {
    const visitable = items.filter((item) => item.kind === 'point' || item.kind === 'place')
    const legMinutes = (legs?.legs ?? []).reduce((sum, leg) => sum + leg.durationSec / 60, 0)
    return {
      stopCount: visitable.length,
      totalHours: (legMinutes + visitable.length * STOP_MINUTES_ESTIMATE) / 60,
    }
  }, [items, legs])

  const dateText = dayDateLabel(day, locale)
  const summaryParts: string[] = []
  if (dateText) summaryParts.push(dateText)
  if (lodgingNames.length > 0) summaryParts.push(lodgingNames.join(' · '))
  summaryParts.push(
    `${tr('routebook.common.stopCount', locale, { n: stopCount })}${
      stopCount > 0 ? tr('routebook.sidebar.dayStatsHours', locale, { h: totalHours.toFixed(1) }) : ''
    }`
  )

  return (
    <>
      <button
        type="button"
        aria-label={tr('routebook.dayDetail.lodgingTitle', locale)}
        className="flex w-full items-center gap-2 rounded-2xl border border-pink-100/80 bg-white/90 px-3 py-2 text-left shadow-sm transition hover:border-brand-200"
        onClick={() => setSheetOpen(true)}
      >
        <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{summaryParts.join(' · ')}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
      </button>

      {sheetOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center">
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}
          />
          <div className="relative mb-0 w-full max-w-md rounded-t-[28px] border border-pink-100 bg-white p-4 pb-8 shadow-[0_-18px_44px_-24px_rgba(15,23,42,0.45)]">
            <div className="mb-3 flex items-center justify-between px-1">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <BedDouble className="h-4 w-4 text-brand-500" />
                {tr('routebook.dayDetail.lodgingTitle', locale)}
              </h3>
              <button
                type="button"
                aria-label={tr('routebook.common.close', locale)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
                onClick={() => setSheetOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {relevant.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center text-xs text-slate-400">
                  {tr('routebook.mobile.noLodging', locale)}
                </div>
              ) : (
                relevant.map((lodging) => {
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
                      className="block w-full rounded-2xl bg-pink-50/60 px-3 py-2 text-left transition hover:bg-pink-50 disabled:cursor-default"
                      onClick={() => {
                        setSheetOpen(false)
                        onEditLodging?.(lodging.id)
                      }}
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
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
