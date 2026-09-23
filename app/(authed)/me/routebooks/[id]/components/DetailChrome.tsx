'use client'

import Link from 'next/link'
import { ChevronRight, Pencil, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'
import { itemDisplayTitle, parseDragRecordId } from '../utils'
import { ITEM_DND_PREFIX, MARKER_DND_PREFIX, POOL_DND_PREFIX } from '../types'
import type { ItemRecord, PlaceRecord, PointPoolItem, PointPreview, RouteBookDetail } from '../types'
import { PlannerPointPoolDragOverlay } from './PlannerPointPoolPanel'
import { tr } from '../../i18n'

/** 装载失败态：错误信息 + 返回列表 */
export function RouteBookDetailError({ error, locale }: { error: string; locale: SupportedLocale }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-rose-50 p-4 text-rose-700">{error}</div>
      <a href="/me/routebooks" className="text-sm text-brand-600 hover:underline">
        {tr('routebook.detail.backToList', locale)}
      </a>
    </div>
  )
}

export function RouteBookDetailSkeleton() {return (
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

/** 拖拽浮层：按 activeDragId 前缀渲染条目卡 / 池卡 */
export function PlannerDragOverlay({
  activeDragId,
  detail,
  pointPoolItems,
  getPointPreview,
  locale,
}: {
  activeDragId: string | null
  detail: RouteBookDetail
  pointPoolItems: PointPoolItem[]
  getPointPreview: (pointId: string) => PointPreview
  locale: SupportedLocale
}) {
  if (!activeDragId) return null
  const itemId = parseDragRecordId(activeDragId, ITEM_DND_PREFIX) ?? parseDragRecordId(activeDragId, MARKER_DND_PREFIX)
  if (itemId) {
    const item = detail.items.find((row) => row.id === itemId)
    if (!item) return null
    return (
      <ItemDragOverlayCard
        item={item}
        preview={item.pointId ? getPointPreview(item.pointId) : null}
        places={detail.places}
        locale={locale}
      />
    )
  }
  const poolId = parseDragRecordId(activeDragId, POOL_DND_PREFIX)
  if (poolId) {
    const poolItem = pointPoolItems.find((row) => row.id === poolId)
    if (!poolItem) return null
    return <PlannerPointPoolDragOverlay preview={getPointPreview(poolItem.pointId)} locale={locale} />
  }
  return null
}

/** 顶部面包屑 + 标题改名（失焦/Enter 保存，Esc 取消） */
export function DetailNav({
  title,
  editing,
  draft,
  onDraftChange,
  onSave,
  onStartEdit,
  onCancelEdit,
  locale,
}: {
  title: string
  editing: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSave: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  locale: SupportedLocale
}) {
  return (
    <nav
      aria-label={tr('routebook.detail.breadcrumbAria', locale)}
      className="border-b border-pink-100/70 bg-white/70 px-4 py-2.5 backdrop-blur-md sm:px-6"
    >
      <div className="mx-auto flex max-w-[1920px] items-center gap-1.5 text-sm text-slate-500">
        <Link href="/me/routebooks" prefetch={false} className="font-medium text-slate-600 no-underline transition hover:text-brand-600">
          {tr('routebook.detail.breadcrumbHome', locale)}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onBlur={onSave}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              if (event.key === 'Escape') onCancelEdit()
            }}
            aria-label={tr('routebook.detail.renameLabel', locale)}
            className="min-w-0 flex-1 rounded-lg border border-brand-200 bg-white px-2 py-1 text-sm font-semibold text-slate-900 outline-none focus:border-brand-400 sm:max-w-md"
          />
        ) : (
          <button
            type="button"
            onClick={onStartEdit}
            title={tr('routebook.detail.renameHint', locale)}
            className="group inline-flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left font-semibold text-slate-900 transition hover:bg-pink-50"
          >
            <span className="truncate">《{title}》</span>
            <Pencil className="h-3 w-3 shrink-0 text-slate-300 transition group-hover:text-brand-500" />
          </button>
        )}
      </div>
    </nav>
  )
}

/** 409 stale 提示条 + /plan 导入摘要条（都可手动关闭） */
export function NoticeBanners({
  staleNotice,
  importSummary,
  onReload,
  onDismissStale,
  onDismissImport,
  locale,
}: {
  staleNotice: boolean
  importSummary: string | null
  onReload: () => void
  onDismissStale: () => void
  onDismissImport: () => void
  locale: SupportedLocale
}) {
  if (!staleNotice && !importSummary) return null
  return (
    <>
      {staleNotice ? (
        <div className="flex items-center justify-between gap-3 rounded-[24px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 shadow-sm">
          <span>{tr('routebook.detail.staleConflict', locale)}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="inline-flex min-h-8 items-center rounded-xl bg-amber-600 px-3 text-xs font-semibold text-white transition hover:bg-amber-700"
              onClick={onReload}
            >
              {tr('routebook.common.reload', locale)}
            </button>
            <button
              type="button"
              aria-label={tr('routebook.detail.closeBanner', locale)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-amber-600 transition hover:bg-amber-100"
              onClick={onDismissStale}
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
      ) : null}
      {importSummary ? (
        <div className="flex items-center justify-between gap-3 rounded-[24px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-800 shadow-sm">
          <span>{importSummary}</span>
          <button
            type="button"
            aria-label={tr('routebook.detail.closeBanner', locale)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-emerald-600 transition hover:bg-emerald-100"
            onClick={onDismissImport}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </>
  )
}
