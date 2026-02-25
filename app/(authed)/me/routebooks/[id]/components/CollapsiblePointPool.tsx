'use client'

import React, { useState, useMemo } from 'react'
import { Search, ChevronDown, ChevronUp, PlusCircle } from 'lucide-react'
import type { PointPoolItem, PointPreview } from '../types'
import { DraggablePointPoolCard } from './PointCard'

interface CollapsiblePointPoolProps {
  pointPoolItems: PointPoolItem[]
  getPointPreview: (pointId: string) => PointPreview | null
  onAddToRoute: (pointId: string) => void
  isExpanded: boolean
  onToggle: () => void
}

export const CollapsiblePointPool: React.FC<CollapsiblePointPoolProps> = ({
  pointPoolItems,
  getPointPreview,
  onAddToRoute,
  isExpanded,
  onToggle,
}) => {
  const [searchQuery, setSearchQuery] = useState('')

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
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden transition-all duration-300 ease-in-out shadow-sm">
      {/* Header / Trigger */}
      <div 
        className="flex cursor-pointer items-center justify-between p-4 hover:bg-slate-50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <PlusCircle size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 sm:text-base">
              全局想去池 ({pointPoolItems.length})
            </h2>
            {!isExpanded && (
              <p className="text-[10px] text-slate-500 sm:text-xs">
                支持把全局点位直接拖进路线区，减少按钮操作
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
        >
          {isExpanded ? (
            <>
              收起 <ChevronUp size={14} />
            </>
          ) : (
            <>
              展开想去池 <ChevronDown size={14} />
            </>
          )}
        </button>
      </div>

      {/* Collapsible Content */}
      <div 
        className={`transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-height-[1000px] opacity-100 border-t border-slate-100' : 'max-h-0 opacity-0 overflow-hidden border-t-0'
        }`}
        style={{ maxHeight: isExpanded ? '1000px' : '0' }}
      >
        <div className="p-4 space-y-4">
          {isEmpty ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
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
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm outline-none ring-brand-100 transition-all focus:border-brand-400 focus:bg-white focus:ring-4"
                />
              </div>

              {/* Items List */}
              <div className="grid grid-cols-1 gap-3 sm:max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredItems.length > 0 ? (
                  filteredItems.map((item) => {
                    const preview = getPointPreview(item.pointId)
                    if (!preview) return null
                    return (
                      <DraggablePointPoolCard
                        key={item.id}
                        item={item}
                        preview={preview}
                        onAdd={() => onAddToRoute(item.pointId)}
                      />
                    )
                  })
                ) : (
                  <div className="py-8 text-center text-sm text-slate-400">
                    没有找到匹配的点位
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
