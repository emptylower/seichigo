'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { Search, Plus, PlusCircle, X } from 'lucide-react'
import type { PointPoolItem, PointPreview, RouteBookDetail } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { PointPoolCard } from './PointCard'
import { PlaceRow, confirmDeletePlace } from './PlannerPointPoolPanel'
import { tr } from '../../i18n'

interface MobilePointPoolSheetProps {
  pointPoolItems: PointPoolItem[]
  getPointPreview: (pointId: string) => PointPreview | null
  /** 「+」加到当前目标（选中天；未安排视图 / 全部 → 未安排） */
  onAddToRoute: (pointId: string) => void
  onRemoveFromPool?: (pointId: string) => void
  /** 自定义点分区：列表 + 加入目标 / 新建 / 编辑 / 删除（删除前确认级联条数） */
  detail?: Pick<RouteBookDetail, 'places' | 'items' | 'lodgings'>
  onAddPlace?: (placeId: string) => void
  onCreatePlace?: () => void
  onEditPlace?: (placeId: string) => void
  onDeletePlace?: (placeId: string) => void
  isOpen: boolean
  onClose: () => void
  /** 加入目标的显示名，例如「Day 2」或「未安排」 */
  targetLabel?: string | null
  locale?: SupportedLocale
}

/**
 * This component is rendered only on mobile (< 768px) via useIsMobile() in parent.
 * It provides a slide-up bottom sheet for the point pool.
 * Drag-and-drop is disabled on mobile to avoid scroll conflicts.
 */
export const MobilePointPoolSheet: React.FC<MobilePointPoolSheetProps> = ({
  pointPoolItems,
  getPointPreview,
  onAddToRoute,
  onRemoveFromPool,
  detail,
  onAddPlace,
  onCreatePlace,
  onEditPlace,
  onDeletePlace,
  isOpen,
  onClose,
  targetLabel = null,
  locale = 'zh',
}) => {
  const [searchQuery, setSearchQuery] = useState('')

  // Reset search when opening
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
    }
  }, [isOpen])

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return pointPoolItems
    const query = searchQuery.toLowerCase()
    return pointPoolItems.filter((item) => {
      const preview = getPointPreview(item.pointId)
      if (!preview) return false
      return (
        preview.title.toLowerCase().includes(query) ||
        preview.subtitle?.toLowerCase().includes(query)
      )
    })
  }, [pointPoolItems, searchQuery, getPointPreview])

  const isEmpty = pointPoolItems.length === 0
  const places = detail?.places ?? []
  const showPlaces = Boolean(detail && (onAddPlace || onCreatePlace || onEditPlace || onDeletePlace))

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-slate-900/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div
        role="dialog"
        aria-hidden={!isOpen}
        aria-label={tr('routebook.pool.title', locale)}
        className={`fixed inset-x-0 bottom-0 z-50 flex h-[75vh] flex-col rounded-t-[32px] bg-white shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Drag Handle & Close */}
        <div className="relative flex h-14 shrink-0 items-center justify-center border-b border-slate-100">
          <div className="h-1.5 w-12 rounded-full bg-slate-200" />
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            onClick={onClose}
            className="absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <PlusCircle size={18} />
            </div>
            <h2 className="text-lg font-bold text-slate-900">
              {tr('routebook.pool.sheetTitle', locale, { n: pointPoolItems.length })}
            </h2>
            {targetLabel ? (
              <span className="ml-auto rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-600">
                {tr('routebook.pool.addToDay', locale, { label: targetLabel })}
              </span>
            ) : null}
          </div>

          {isEmpty ? null : (
            <div className="relative group">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-500 transition-colors"
                size={16}
              />
              <input
                type="text"
                placeholder={tr('routebook.pool.sheetSearchPlaceholder', locale)}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none ring-brand-100 transition-all focus:border-brand-400 focus:bg-white focus:ring-4"
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3">
            {showPlaces && detail ? (
              <section aria-label={tr('routebook.pool.placesTitle', locale, { n: places.length })} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-semibold text-slate-500">
                    {tr('routebook.pool.placesTitle', locale, { n: places.length })}
                  </h3>
                  {onCreatePlace ? (
                    <button
                      type="button"
                      className="inline-flex min-h-8 items-center gap-1 rounded-xl px-2 text-xs font-medium text-brand-600 transition hover:bg-brand-50"
                      onClick={onCreatePlace}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {tr('routebook.pool.addPlace', locale)}
                    </button>
                  ) : null}
                </div>
                {places.length > 0 ? (
                  places.map((place) => (
                    <PlaceRow
                      key={place.id}
                      place={place}
                      selectedDayId={null}
                      addHint={targetLabel ? tr('routebook.pool.addToDay', locale, { label: targetLabel }) : undefined}
                      locale={locale}
                      onAddToDay={onAddPlace ? () => onAddPlace(place.id) : undefined}
                      onEdit={onEditPlace ? () => onEditPlace(place.id) : undefined}
                      onDelete={
                        onDeletePlace
                          ? () => {
                              if (confirmDeletePlace(detail, place.id, locale)) onDeletePlace(place.id)
                            }
                          : undefined
                      }
                    />
                  ))
                ) : (
                  <p className="px-1 text-[11px] text-slate-400">{tr('routebook.pool.placesEmpty', locale)}</p>
                )}
              </section>
            ) : null}

            {isEmpty ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                <p className="text-sm text-slate-500">
                  {tr('routebook.pool.sheetEmptyPre', locale)}
                  <a href="/anitabi" className="mx-1 font-medium text-brand-600 hover:underline">
                    {tr('routebook.pool.emptyLink', locale)}
                  </a>
                  {tr('routebook.pool.sheetEmptyPost', locale)}
                </p>
              </div>
            ) : filteredItems.length > 0 ? (
              filteredItems.map((item) => {
                const preview = getPointPreview(item.pointId)
                if (!preview) return null
                return (
                  <PointPoolCard
                    key={item.id}
                    item={item}
                    preview={preview}
                    onAdd={() => onAddToRoute(item.pointId)}
                    onRemove={onRemoveFromPool ? () => onRemoveFromPool(item.pointId) : undefined}
                    locale={locale}
                  />
                )
              })
            ) : (
              <div className="py-12 text-center text-sm text-slate-400">
                {tr('routebook.pool.emptyNoMatch', locale)}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
