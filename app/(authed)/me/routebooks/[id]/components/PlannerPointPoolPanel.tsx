'use client'

import { useMemo, useState } from 'react'
import { Check, Grid2X2, List, Plus, Search, Sparkles } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { PointPreview } from '../types'

export type PlannerPoolItem = {
  id: string
  pointId: string
  preview: PointPreview
  selected: boolean
  dragId?: string
  onAdd?: () => void
}

function PoolCardContent({
  item,
  compact = false,
  list = false,
}: {
  item: PlannerPoolItem
  compact?: boolean
  list?: boolean
}) {
  const buttonClass = item.selected
    ? 'bg-brand-500 text-white'
    : 'bg-white/85 text-slate-700 hover:bg-brand-500 hover:text-white'

  if (list) {
    return (
      <article
        className={`group flex items-center gap-3 rounded-[24px] border bg-white p-3 transition ${
          item.selected ? 'border-brand-200 bg-pink-50/65' : 'border-slate-200 hover:border-pink-200'
        }`}
      >
        <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-[18px] bg-slate-100">
          {item.preview.image ? (
            <img src={item.preview.image} alt={item.preview.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-100 via-white to-cyan-100 text-[11px] font-medium text-slate-500">
              暂无图
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900">{item.preview.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
              {item.preview.subtitle}
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={item.selected || !item.onAdd}
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-transparent transition ${buttonClass} disabled:cursor-default`}
          onClick={() => item.onAdd?.()}
        >
          {item.selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      </article>
    )
  }

  return (
    <article
      className={`group overflow-hidden rounded-[26px] border bg-white transition ${
        item.selected ? 'border-brand-200 bg-pink-50/65' : 'border-slate-200 hover:border-pink-200'
      }`}
    >
      <div className={`relative overflow-hidden ${compact ? 'aspect-[1.08/1]' : 'aspect-[1.02/1]'}`}>
        {item.preview.image ? (
          <img src={item.preview.image} alt={item.preview.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-100 via-white to-cyan-100 px-4 text-center text-xs font-medium text-slate-500">
            暂无图片
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(15,23,42,0.68)_6%,rgba(15,23,42,0.12)_54%,rgba(15,23,42,0)_82%)]" />
        <button
          type="button"
          disabled={item.selected || !item.onAdd}
          className={`absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full shadow-sm backdrop-blur-sm transition ${buttonClass} disabled:cursor-default`}
          onClick={() => item.onAdd?.()}
        >
          {item.selected ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className="line-clamp-2 text-base font-semibold leading-6 text-white">{item.preview.title}</h3>
          <span className="mt-2 inline-flex rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            {item.preview.subtitle}
          </span>
        </div>
      </div>
    </article>
  )
}

function DraggablePoolCard({
  item,
  compact = false,
  list = false,
}: {
  item: PlannerPoolItem
  compact?: boolean
  list?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.dragId || item.id,
    disabled: item.selected || !item.dragId,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.72 : 1 }}
      {...attributes}
      {...listeners}
      className={item.selected ? '' : 'touch-none'}
    >
      <PoolCardContent item={item} compact={compact} list={list} />
    </div>
  )
}

export function PlannerPointPoolDragOverlay({ item }: { item: PlannerPoolItem }) {
  return <PoolCardContent item={item} />
}

interface PlannerPointPoolPanelProps {
  items: PlannerPoolItem[]
  compact?: boolean
  enableDrag?: boolean
}

export function PlannerPointPoolPanel({
  items,
  compact = false,
  enableDrag = false,
}: PlannerPointPoolPanelProps) {
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeTag, setActiveTag] = useState('全部')

  const selectedCount = items.filter((item) => item.selected).length
  const tags = useMemo(() => {
    const values = Array.from(new Set(items.map((item) => item.preview.subtitle).filter(Boolean)))
    return ['全部', ...values]
  }, [items])

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return items.filter((item) => {
      const matchesTag = activeTag === '全部' || item.preview.subtitle === activeTag
      if (!matchesTag) return false
      if (!normalized) return true
      return (
        item.preview.title.toLowerCase().includes(normalized) ||
        item.preview.subtitle.toLowerCase().includes(normalized) ||
        item.pointId.toLowerCase().includes(normalized)
      )
    })
  }, [activeTag, items, query])

  const showList = !compact && viewMode === 'list'

  if (items.length === 0) {
    return (
      <section className="flex min-h-[24rem] flex-col rounded-[32px] border border-pink-100/90 bg-white p-4 shadow-[0_24px_44px_-34px_rgba(15,23,42,0.42)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-50 text-brand-600">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">点位池</h2>
            <p className="text-xs text-slate-500">还没有候选点位</p>
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col items-center justify-center rounded-[28px] border border-dashed border-pink-200 bg-pink-50/30 px-6 text-center">
          <p className="text-sm font-medium text-slate-700">点位池还是空的</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            去
            <a href="/anitabi" className="mx-1 font-semibold text-brand-600 hover:underline">
              圣地地图
            </a>
            收藏想去的圣地，再回来整理这张路线图。
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className={`flex min-h-0 flex-col rounded-[32px] border border-pink-100/90 bg-white shadow-[0_24px_44px_-34px_rgba(15,23,42,0.42)] ${compact ? 'p-4' : 'p-4'}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-50 text-brand-600">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">点位池</h2>
              <p className="text-xs text-slate-500">
                {items.length} 个候选点位，已加入 {selectedCount} 个
              </p>
            </div>
          </div>
          {!compact ? (
            <div className="inline-flex rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition ${!showList ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                onClick={() => setViewMode('grid')}
              >
                <Grid2X2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition ${showList ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索点位、作品或 pointId"
            className="w-full rounded-[22px] border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
          />
        </label>

        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
            {tags.map((tag) => {
              const active = tag === activeTag
              return (
                <button
                  key={tag}
                  type="button"
                  className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 text-sm font-medium transition ${
                    active
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : 'border-pink-100 bg-white text-slate-700 hover:border-pink-200 hover:bg-pink-50/60'
                  }`}
                  onClick={() => setActiveTag(tag)}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className={`mt-4 min-h-0 flex-1 ${compact ? '' : ''}`}>
        {filteredItems.length > 0 ? (
          <div className={`${showList ? 'space-y-3' : 'grid grid-cols-2 gap-3'} ${compact ? 'pb-24' : 'max-h-[calc(100vh-26rem)] overflow-y-auto pr-1'}`}>
            {filteredItems.map((item) =>
              enableDrag ? (
                <DraggablePoolCard key={item.id} item={item} compact={compact} list={showList} />
              ) : (
                <PoolCardContent key={item.id} item={item} compact={compact} list={showList} />
              )
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-[16rem] flex-col items-center justify-center rounded-[28px] border border-dashed border-pink-200 bg-pink-50/30 px-6 text-center">
            <Search className="h-6 w-6 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">没有找到匹配的点位</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">换个作品标签，或尝试搜索原始 pointId。</p>
          </div>
        )}
      </div>
    </section>
  )
}
