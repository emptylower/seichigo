'use client'

import { useEffect, useState } from 'react'
import { BedDouble, Loader2, Plus, X } from 'lucide-react'
import type { LodgingRecord, RouteBookDetail } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { LodgingInput } from '../hooks/tripDataTypes'
import { dayLabel } from '../utils'
import { tr } from '../../i18n'

type Props = {
  open: boolean
  detail: RouteBookDetail
  /** 传入则为编辑模式 */
  lodging?: LodgingRecord | null
  /** 新建时预选住宿点（例如刚建好的 lodging 自定义点） */
  presetPlaceId?: string | null
  /** DayBlock「添加住宿」：预选入住日 */
  presetDayIndex?: number | null
  onSubmit: (input: LodgingInput) => Promise<boolean | void> | boolean | void
  /** 没有 lodging 自定义点时跳去新建（由 DialogsHost 编排） */
  onRequestNewPlace: () => void
  onClose: () => void
  locale?: SupportedLocale
}

/** 住宿区间：选已有 lodging 自定义点（或跳去新建）、入住日..退房日、可选时间 */
export function LodgingDialog({
  open,
  detail,
  lodging = null,
  presetPlaceId = null,
  presetDayIndex = null,
  onSubmit,
  onRequestNewPlace,
  onClose,
  locale = 'zh',
}: Props) {
  const [placeId, setPlaceId] = useState('')
  const [fromDayIndex, setFromDayIndex] = useState(1)
  const [toDayIndex, setToDayIndex] = useState(1)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const lodgingPlaces = detail.places.filter((row) => row.kind === 'lodging')
  const days = [...detail.days].sort((a, b) => a.dayIndex - b.dayIndex)

  useEffect(() => {
    if (!open) return
    const fallbackFrom = presetDayIndex ?? 1
    setPlaceId(lodging?.placeId ?? presetPlaceId ?? lodgingPlaces[0]?.id ?? '')
    setFromDayIndex(lodging?.fromDayIndex ?? fallbackFrom)
    setToDayIndex(lodging?.toDayIndex ?? Math.min(fallbackFrom + 1, detail.dayCount))
    setCheckIn(lodging?.checkIn ?? '')
    setCheckOut(lodging?.checkOut ?? '')
    setNote(lodging?.note ?? '')
    setSubmitting(false)
    // lodgingPlaces 在打开瞬间已确定；后续 detail 变化不重置表单
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lodging, presetPlaceId, presetDayIndex])

  if (!open) return null

  const valid = placeId !== '' && fromDayIndex >= 1 && toDayIndex >= fromDayIndex

  const handleSubmit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    const outcome = await onSubmit({
      placeId,
      fromDayIndex,
      toDayIndex,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      note: note.trim() || null,
    })
    setSubmitting(false)
    if (outcome !== false) onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label={tr('routebook.common.close', locale)}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-pink-100 bg-white p-5 shadow-2xl sm:rounded-[28px]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <BedDouble className="h-4 w-4 text-brand-500" />
            {lodging ? tr('routebook.lodging.edit', locale) : tr('routebook.lodging.add', locale)}
          </h3>
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {lodgingPlaces.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-pink-200 bg-pink-50/40 px-4 py-6 text-center">
            <p className="text-sm text-slate-500">{tr('routebook.lodging.noPlaceHint', locale)}</p>
            <button
              type="button"
              className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-2xl bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600"
              onClick={onRequestNewPlace}
            >
              <Plus className="h-4 w-4" />
              {tr('routebook.lodging.newPlace', locale)}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.lodging.placeLabel', locale)}</span>
              <select
                value={placeId}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
                onChange={(event) => setPlaceId(event.target.value)}
              >
                {lodgingPlaces.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.lodging.fromLabel', locale)}</span>
                <select
                  value={fromDayIndex}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setFromDayIndex(next)
                    if (toDayIndex < next) setToDayIndex(next)
                  }}
                >
                  {days.map((day) => (
                    <option key={day.id} value={day.dayIndex}>
                      {dayLabel(day, day.dayIndex, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.lodging.toLabel', locale)}</span>
                <select
                  value={toDayIndex}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
                  onChange={(event) => setToDayIndex(Number(event.target.value))}
                >
                  {days
                    .filter((day) => day.dayIndex >= fromDayIndex)
                    .map((day) => (
                      <option key={day.id} value={day.dayIndex}>
                        {dayLabel(day, day.dayIndex, locale)}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.lodging.checkInLabel', locale)}</span>
                <input
                  type="time"
                  value={checkIn}
                  onChange={(event) => setCheckIn(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.lodging.checkOutLabel', locale)}</span>
                <input
                  type="time"
                  value={checkOut}
                  onChange={(event) => setCheckOut(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.lodging.noteLabel', locale)}</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[20px] border border-pink-100 bg-white text-sm font-medium text-slate-600 transition hover:bg-pink-50"
                onClick={onRequestNewPlace}
              >
                <Plus className="h-4 w-4" />
                {tr('routebook.lodging.newPlace', locale)}
              </button>
              <button
                type="button"
                disabled={!valid || submitting}
                className="inline-flex min-h-12 flex-[2] items-center justify-center gap-2 rounded-[20px] bg-brand-500 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => void handleSubmit()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {tr('routebook.lodging.submit', locale)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
