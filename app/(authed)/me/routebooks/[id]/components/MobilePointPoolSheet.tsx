'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { Search, PlusCircle, X } from 'lucide-react'
import type { PointPoolItem, PointPreview } from '../types'
import { PointPoolCard } from './PointCard'

interface MobilePointPoolSheetProps {
  pointPoolItems: PointPoolItem[]
  getPointPreview: (pointId: string) => PointPreview | null
  onAddToRoute: (pointId: string) => void
  isOpen: boolean
  onClose: () => void
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
  isOpen,
  onClose,
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
        className={`fixed inset-x-0 bottom-0 z-50 flex h-[70vh] flex-col rounded-t-[32px] bg-white shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Drag Handle & Close */}
        <div className="relative flex h-14 shrink-0 items-center justify-center border-b border-slate-100">
          <div className="h-1.5 w-12 rounded-full bg-slate-200" />
          <button 
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
              全局想去池 ({pointPoolItems.length})
            </h2>
          </div>

          {isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-8 text-center">
              <p className="text-sm text-slate-500">
                想去池为空。去
                <a href="/anitabi" className="mx-1 font-medium text-brand-600 hover:underline">
                  圣地地图
                </a>
                点击“想去”来收集点位。
              </p>
            </div>
          ) : (
            <>
              {/* Search Box */}
              <div className="relative group">
                <Search 
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-500 transition-colors" 
                  size={16} 
                />
                <input
                  type="text"
                  placeholder="搜索点位名称或副标题..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none ring-brand-100 transition-all focus:border-brand-400 focus:bg-white focus:ring-4"
                />
              </div>

              {/* Items List */}
              <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3">
                {filteredItems.length > 0 ? (
                  filteredItems.map((item) => {
                    const preview = getPointPreview(item.pointId)
                    if (!preview) return null
                    return (
                      <PointPoolCard
                        key={item.id}
                        item={item}
                        preview={preview}
                        onAdd={() => onAddToRoute(item.pointId)}
                      />
                    )
                  })
                ) : (
                  <div className="py-12 text-center text-sm text-slate-400">
                    没有找到匹配的点位
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
