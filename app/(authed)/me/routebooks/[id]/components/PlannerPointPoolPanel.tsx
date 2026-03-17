'use client'

import { useMemo, useState } from 'react'
import { Check, Grid2X2, List, Plus, Search, Settings2, Sparkles, Trash2 } from 'lucide-react'
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
  onRemove?: () => void
}

function PoolCardContent({
  item,
  compact = false,
  list = false,
  manageMode = false,
}: {
  item: PlannerPoolItem
  compact?: boolean
  list?: boolean
  manageMode?: boolean
}) {
  const mobileManageAction = compact && manageMode

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
            <img src={item.preview.image} alt={item.preview.title} loading="lazy" decoding="async" className="h-full w-full object-cover object-center" />
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
        {manageMode ? (
          <button
            type="button"
            aria-label="从点位池删除"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
            onClick={() => item.onRemove?.()}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={item.selected || !item.onAdd}
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-transparent transition ${buttonClass} disabled:cursor-default`}
            onClick={() => item.onAdd?.()}
          >
            {item.selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
        )}
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
          <img src={item.preview.image} alt={item.preview.title} loading="lazy" decoding="async" className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-100 via-white to-cyan-100 px-4 text-center text-xs font-medium text-slate-500">
            暂无图片
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(15,23,42,0.68)_6%,rgba(15,23,42,0.12)_54%,rgba(15,23,42,0)_82%)]" />
        {manageMode && !mobileManageAction ? (
          <button
            type="button"
            aria-label="从点位池删除"
            className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 shadow-sm backdrop-blur-sm transition hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
            onClick={() => item.onRemove?.()}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={item.selected || !item.onAdd}
            className={`absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full shadow-sm backdrop-blur-sm transition ${buttonClass} disabled:cursor-default`}
            onClick={() => item.onAdd?.()}
          >
            {item.selected ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className="line-clamp-2 text-base font-semibold leading-6 text-white">{item.preview.title}</h3>
          <span className="mt-2 inline-flex rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            {item.preview.subtitle}
          </span>
        </div>
      </div>
      {mobileManageAction ? (
        <div className="border-t border-rose-100 bg-white px-3 py-3 flex justify-end">
          <button
            type="button"
            aria-label="从点位池删除"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
            onClick={() => item.onRemove?.()}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </article>
  )
}

function DraggablePoolCard({
  item,
  compact = false,
  list = false,
  manageMode = false,
}: {
  item: PlannerPoolItem
  compact?: boolean
  list?: boolean
  manageMode?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.dragId || item.id,
    disabled: manageMode || item.selected || !item.dragId,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.72 : 1 }}
      {...attributes}
      {...listeners}
      className={item.selected || manageMode ? '' : 'touch-none'}
    >
      <PoolCardContent item={item} compact={compact} list={list} manageMode={manageMode} />
    </div>
  )
}

export function PlannerPointPoolDragOverlay({ item }: { item: PlannerPoolItem }) {
  return <PoolCardContent item={item} />
}

interface PlannerPointPoolPanelProps {
  items: PlannerPoolItem[]
  selectedCount?: number
  totalCount?: number
  compact?: boolean
  enableDrag?: boolean
}

export function PlannerPointPoolPanel({
  items,
  selectedCount = 0,
  totalCount = items.length,
  compact = false,
  enableDrag = false,
}: PlannerPointPoolPanelProps) {
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [manageMode, setManageMode] = useState(false)
  const [activeTag, setActiveTag] = useState('全部')

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
    <section className={`flex h-full min-h-0 flex-col rounded-[32px] border border-pink-100/90 bg-white shadow-[0_24px_44px_-34px_rgba(15,23,42,0.42)] ${compact ? 'p-4' : 'p-4'}`}>
      <div className="space-y-4 rounded-[28px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,244,247,0.92))] p-4 shadow-[0_18px_36px_-30px_rgba(225,29,72,0.3)] ring-1 ring-pink-100/60">
        <div className="flex items-start gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-50 text-brand-600">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-400">Point reservoir</div>
              <h2 className="text-lg font-semibold text-slate-900">点位池</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{totalCount} 个候选点位，已加入 {selectedCount} 个。</p>
            </div>
          </div>

        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center justify-end gap-2">
            {!compact ? (
              <div className="inline-flex rounded-[22px] bg-slate-100/80 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] ring-1 ring-pink-100/70">
                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl transition ${!showList ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'}`}
                  onClick={() => setViewMode('grid')}
                >
                  <Grid2X2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl transition ${showList ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'}`}
                  onClick={() => setViewMode('list')}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <button
              type="button"
              onClick={() => setManageMode((prev) => !prev)}
              className={`inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2 text-sm font-semibold transition xl:w-auto xl:rounded-full xl:text-xs ${manageMode ? 'bg-rose-100 text-rose-700 shadow-[0_12px_24px_-22px_rgba(244,63,94,0.5)] ring-1 ring-rose-200/80' : 'bg-white text-slate-700 shadow-[0_12px_24px_-24px_rgba(15,23,42,0.28)] ring-1 ring-slate-200/80 hover:bg-slate-50'}`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {manageMode ? '完成管理' : '管理点位池'}
            </button>
          </div>
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

        <div className="relative -mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1 touch-pan-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-6 before:bg-[linear-gradient(90deg,rgba(255,250,252,0.96),rgba(255,250,252,0))] after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-6 after:bg-[linear-gradient(270deg,rgba(255,250,252,0.96),rgba(255,250,252,0))]">
          <div className="inline-flex w-max gap-2 pr-6">
            {tags.map((tag) => {
              const active = tag === activeTag
              return (
                <button
                  key={tag}
                  type="button"
                  className={`inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition ${
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

      <div className="mt-4 min-h-0 flex-1">
        {filteredItems.length > 0 ? (
          <div className={`${showList ? 'space-y-3' : 'grid grid-cols-2 gap-4'} ${compact ? 'pb-24' : 'seichi-soft-scrollbar h-full overflow-y-auto pr-2'}`}>
            {filteredItems.map((item) =>
              enableDrag ? (
                <DraggablePoolCard key={item.id} item={item} compact={compact} list={showList} manageMode={manageMode} />
              ) : (
                <PoolCardContent key={item.id} item={item} compact={compact} list={showList} manageMode={manageMode} />
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
