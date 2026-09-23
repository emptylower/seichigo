'use client'

import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { itemDisplayTitle } from '../utils'
import type { ItemRecord, PlaceRecord, PointPreview } from '../types'

export function RouteBookDetailSkeleton() {
  return (
    <div data-layout-wide="true" className="min-h-dvh bg-[linear-gradient(180deg,#fffafc_0%,#fff5f9_100%)]">
      <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-5 sm:px-6">
        <div className="h-5 w-48 animate-pulse rounded-full bg-pink-100/70" />
        <section className="hidden gap-5 lg:grid lg:grid-cols-[420px_minmax(0,1fr)_420px]">
          <div className="h-[74vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
          <div className="h-[74vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
          <div className="h-[74vh] animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
        </section>
        <section className="space-y-4 lg:hidden">
          <div className="h-12 animate-pulse rounded-[24px] bg-pink-100/70" />
          <div className="h-80 animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
          <div className="h-64 animate-pulse rounded-[32px] border border-pink-100/90 bg-white/90 shadow-sm" />
        </section>
      </div>
    </div>
  )
}

export type ImportCounts = {
  days: number
  points: number
  transits: number
  lodgings: number
  degradedToNote: number
}

export function parseImportCounts(raw: string | null): ImportCounts | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const row = parsed as Record<string, unknown>
    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    return {
      days: num(row.days),
      points: num(row.points),
      transits: num(row.transits),
      lodgings: num(row.lodgings),
      degradedToNote: num(row.degradedToNote),
    }
  } catch {
    return null
  }
}

export function formatImportSummary(counts: ImportCounts, locale: SupportedLocale): string {
  const base = t('routebook.importSummary', locale)
    .split('{days}')
    .join(String(counts.days))
    .split('{points}')
    .join(String(counts.points))
    .split('{transits}')
    .join(String(counts.transits))
    .split('{lodgings}')
    .join(String(counts.lodgings))
  if (counts.degradedToNote > 0) {
    return base + t('routebook.importDegraded', locale).split('{n}').join(String(counts.degradedToNote))
  }
  return base
}

/** 详情接口的 lang 参数（与 lib/googlePlaces/details.ts 的 PlaceIntroLang 对齐） */
export function placeIntroLang(locale: SupportedLocale): 'zh-CN' | 'en' | 'ja' {
  return locale === 'en' ? 'en' : locale === 'ja' ? 'ja' : 'zh-CN'
}

export function ItemDragOverlayCard({
  item,
  preview,
  places,
  locale,
}: {
  item: ItemRecord
  preview: PointPreview | null
  places: PlaceRecord[]
  locale: SupportedLocale
}) {
  return (
    <div className="w-64 rounded-2xl border border-brand-200 bg-white p-3 shadow-[0_24px_36px_-24px_rgba(225,29,72,0.5)]">
      <div className="truncate text-sm font-semibold text-slate-900">{itemDisplayTitle(item, preview, places, locale)}</div>
      {item.timeStart ? (
        <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
          {item.timeStart}
        </div>
      ) : null}
    </div>
  )
}
