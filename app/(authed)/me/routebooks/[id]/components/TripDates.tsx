'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import { dayDateLabel } from '../utils'
import { tr } from '../../i18n'

type SaveStartDate = (startDate: string | null) => Promise<boolean>

/** 开始日期表单：<input type="date"> + 保存 / 清除日期；提交 ISO（UTC 零点）或 null，各天 date 由开始日期顺推 */
export function TripDatesForm({
  startDate,
  onSave,
  onDone,
  locale = 'zh',
}: {
  startDate: string | null
  onSave: SaveStartDate
  onDone?: () => void
  locale?: SupportedLocale
}) {
  const initial = startDate ? startDate.slice(0, 10) : ''
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)

  const submit = async (next: string | null) => {
    setBusy(true)
    const ok = await onSave(next)
    setBusy(false)
    if (ok) onDone?.()
  }

  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!value || value === initial) return
        void submit(`${value}T00:00:00.000Z`)
      }}
    >
      <label className="block text-xs font-medium text-slate-600">
        {tr('routebook.dates.startLabel', locale)}
        <input
          type="date"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-pink-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-300"
        />
      </label>
      <p className="text-[11px] text-slate-400">{tr('routebook.dates.hint', locale)}</p>
      <div className="flex items-center justify-end gap-2">
        {startDate ? (
          <button
            type="button"
            disabled={busy}
            className="mr-auto rounded-xl px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
            onClick={() => void submit(null)}
          >
            {tr('routebook.dates.clear', locale)}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={busy || !value || value === initial}
          className="rounded-xl bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {tr('routebook.dates.save', locale)}
        </button>
      </div>
    </form>
  )
}

/** 面包屑标题旁的「日期」按钮 + 小弹窗 */
export function TripDatesButton({
  startDate,
  onSave,
  locale = 'zh',
}: {
  startDate: string | null
  onSave: SaveStartDate
  locale?: SupportedLocale
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const label = startDate ? dayDateLabel({ date: startDate }, locale) : null

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tr('routebook.dates.aria', locale)}
        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs font-medium text-slate-500 transition hover:bg-pink-50 hover:text-brand-600"
        onClick={() => setOpen((cur) => !cur)}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        <span>{label ?? tr('routebook.dates.button', locale)}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={tr('routebook.dates.title', locale)}
          className="absolute left-0 top-full z-[60] mt-1.5 w-64 rounded-2xl border border-pink-100 bg-white p-3 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.45)]"
        >
          <div className="mb-2 text-sm font-semibold text-slate-900">{tr('routebook.dates.title', locale)}</div>
          <TripDatesForm startDate={startDate} onSave={onSave} onDone={() => setOpen(false)} locale={locale} />
        </div>
      ) : null}
    </div>
  )
}
