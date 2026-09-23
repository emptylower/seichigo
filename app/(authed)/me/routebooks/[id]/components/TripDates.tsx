'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

const POPOVER_WIDTH = 256

type PopoverPos = { left: number; top: number; width: number }

/** 弹层挂到 body（fixed 定位），盖在地图舞台与详情卡之上，不被祖先 overflow 裁切；宽度不超过视口 */
function computePopoverPos(trigger: HTMLElement): PopoverPos {
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  return { left, top: rect.bottom + 6, width }
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
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // 视口变化（含移动端软键盘弹出）时重新定位，而不是关闭——否则输入日期时弹层会消失
    const reposition = () => {
      if (triggerRef.current) setPos(computePopoverPos(triggerRef.current))
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  const label = startDate ? dayDateLabel({ date: startDate }, locale) : null

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tr('routebook.dates.aria', locale)}
        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs font-medium text-slate-500 transition hover:bg-pink-50 hover:text-brand-600"
        onClick={() => {
          if (!open && triggerRef.current) setPos(computePopoverPos(triggerRef.current))
          setOpen((cur) => !cur)
        }}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        <span>{label ?? tr('routebook.dates.button', locale)}</span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={tr('routebook.dates.title', locale)}
              style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width }}
              className="z-[130] rounded-2xl border border-pink-100 bg-white p-3 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.45)]"
            >
              <div className="mb-2 text-sm font-semibold text-slate-900">{tr('routebook.dates.title', locale)}</div>
              <TripDatesForm startDate={startDate} onSave={onSave} onDone={() => setOpen(false)} locale={locale} />
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
