'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, Download, Route } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/types'
import { tr } from '../../i18n'

export type ExportEntry = {
  key: 'gpxAll' | 'gpxDay' | 'ics'
  label: string
  /** null = 不可用（hint 说明原因） */
  href: string | null
  hint: string | null
}

/** 导出三项：GPX 整程 / GPX 当天（选中天时才有）/ ICS（无日期时禁用） */
export function buildExportEntries(
  routeBookId: string,
  selectedDayIndex: number | null,
  hasDates: boolean,
  locale: SupportedLocale
): ExportEntry[] {
  const base = `/api/me/routebooks/${encodeURIComponent(routeBookId)}`
  const entries: ExportEntry[] = [
    { key: 'gpxAll', label: tr('routebook.export.gpxAll', locale), href: `${base}/export.gpx?scope=all`, hint: null },
  ]
  if (selectedDayIndex !== null) {
    entries.push({
      key: 'gpxDay',
      label: tr('routebook.export.gpxDay', locale, { n: selectedDayIndex }),
      href: `${base}/export.gpx?scope=day&dayIndex=${selectedDayIndex}`,
      hint: null,
    })
  }
  entries.push({
    key: 'ics',
    label: tr('routebook.export.ics', locale),
    href: hasDates ? `${base}/export.ics` : null,
    hint: hasDates ? null : tr('routebook.export.icsNeedDates', locale),
  })
  return entries
}

/** 导出项列表（下拉 / 移动端 sheet 共用）；都是 <a download> 直链，禁用项渲染为不可点的说明行 */
export function ExportOptions({
  entries,
  asMenu = false,
  onPicked,
}: {
  entries: ExportEntry[]
  asMenu?: boolean
  onPicked?: () => void
}) {
  return (
    <div className="space-y-1.5">
      {entries.map((entry) => {
        const Icon = entry.key === 'ics' ? CalendarDays : Route
        const body = (
          <>
            <Icon className="h-4 w-4 shrink-0 text-brand-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{entry.label}</span>
              {entry.hint ? <span className="block text-[11px] text-slate-400">{entry.hint}</span> : null}
            </span>
          </>
        )
        const className =
          'flex w-full items-center gap-3 rounded-2xl border border-pink-100/80 bg-white px-3.5 py-2.5 text-left no-underline transition'
        return entry.href ? (
          <a
            key={entry.key}
            href={entry.href}
            download
            role={asMenu ? 'menuitem' : undefined}
            className={`${className} hover:border-brand-200 hover:bg-pink-50/60`}
            onClick={() => onPicked?.()}
          >
            {body}
          </a>
        ) : (
          <div
            key={entry.key}
            role={asMenu ? 'menuitem' : undefined}
            aria-disabled="true"
            title={entry.hint ?? undefined}
            className={`${className} cursor-not-allowed opacity-60`}
          >
            {body}
          </div>
        )
      })}
    </div>
  )
}

type Props = {
  routeBookId: string
  selectedDayIndex: number | null
  hasDates: boolean
  locale?: SupportedLocale
}

/** 桌面侧栏工具栏「导出 ▾」下拉 */
export function ExportMenu({ routeBookId, selectedDayIndex, hasDates, locale = 'zh' }: Props) {
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

  const entries = buildExportEntries(routeBookId, selectedDayIndex, hasDates, locale)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-white px-2.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-pink-50"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Download className="h-3.5 w-3.5" />
        {tr('routebook.export.button', locale)}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={tr('routebook.export.menuLabel', locale)}
          className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-2xl border border-pink-100 bg-white p-2 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.45)]"
        >
          <ExportOptions entries={entries} asMenu onPicked={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  )
}
