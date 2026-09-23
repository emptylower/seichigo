'use client'

import { CalendarDays, X } from 'lucide-react'
import type { DayRecord, ItemRecord } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { dayLabel, sequenceForImmersive } from '../utils'
import { tr } from '../../i18n'

type Props = {
  open: boolean
  days: DayRecord[]
  items: ItemRecord[]
  onPick: (dayId: string) => void
  onClose: () => void
  locale?: SupportedLocale
}

/** 无日期行程点「开始」时的选天底部 sheet（简单列表） */
export function StartDayPickerSheet({ open, days, items, onPick, onClose, locale = 'zh' }: Props) {
  if (!open) return null
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <button
        type="button"
        aria-label={tr('routebook.dayPicker.closeLabel', locale)}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative mb-0 w-full max-w-md rounded-t-[28px] border border-pink-100 bg-white p-4 pb-8 shadow-[0_-18px_44px_-24px_rgba(15,23,42,0.45)]">
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="text-base font-semibold text-slate-900">{tr('routebook.dayPicker.title', locale)}</h3>
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {sorted.map((day) => {
            const stopCount = sequenceForImmersive(items, day.id).length
            return (
              <button
                key={day.id}
                type="button"
                disabled={stopCount === 0}
                className="flex w-full items-center gap-3 rounded-2xl border border-pink-100/80 bg-white px-4 py-3 text-left transition hover:border-brand-200 hover:bg-pink-50/60 disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => onPick(day.id)}
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-brand-500">
                  <CalendarDays className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{dayLabel(day, day.dayIndex, locale)}</span>
                  {day.title ? <span className="block truncate text-xs text-slate-400">{day.title}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {stopCount > 0
                    ? tr('routebook.common.stopCount', locale, { n: stopCount })
                    : tr('routebook.common.noStops', locale)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
