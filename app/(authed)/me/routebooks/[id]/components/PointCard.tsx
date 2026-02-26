import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { PointRecord, PointPoolItem, PointPreview } from '../types'
import { 
  SORTED_LIMIT, 
  DRAG_SAFE_CONTROL_PROPS 
} from '../types'
import { 
  pickPointGradient, 
  sortedDragId, 
  poolDragId 
} from '../utils'

export function PointThumb({ preview, seed }: { preview: PointPreview; seed: string }) {
  const gradient = pickPointGradient(seed)

  if (preview.image) {
    return (
      <img
        src={preview.image}
        alt={preview.title}
        loading="lazy"
        decoding="async"
        className="h-full w-full bg-slate-100 p-1 object-contain"
      />
    )
  }

  return (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient}`}>
      <div className="rounded-md bg-black/35 px-3 py-1.5 text-xs font-semibold text-white">
        暂无截图
      </div>
    </div>
  )
}

export const PointCard = React.memo(function PointCard({
  point,
  preview,
  indexLabel,
  onRemove,
  onMoveToSorted,
  canMoveToSorted,
  sortable,
  isDragging,
}: {
  point: PointRecord
  preview: PointPreview
  indexLabel?: string
  onRemove: (pointId: string) => void
  onMoveToSorted?: () => void
  canMoveToSorted: boolean
  sortable?: boolean
  isDragging?: boolean
}) {
  return (
    <article
      className={`group overflow-hidden rounded-2xl border bg-white shadow-[0_14px_30px_-25px_rgba(15,23,42,0.45)] transition ${
        isDragging ? 'border-brand-300 ring-2 ring-brand-200/70' : 'border-pink-100/90'
      } ${sortable ? 'cursor-grab select-none active:cursor-grabbing' : ''}`}
    >
      <div className="flex min-w-0 items-stretch">
        <div className="relative h-28 w-36 shrink-0 overflow-hidden border-r border-pink-50/90 sm:h-32 sm:w-44">
          <PointThumb preview={preview} seed={point.pointId} />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,6,23,0.68)_10%,rgba(2,6,23,0.08)_58%,rgba(255,255,255,0)_100%)]" />
          <div className="absolute left-2 top-2 inline-flex rounded-full border border-white/55 bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-slate-700 backdrop-blur-sm">
            {point.zone === 'sorted' ? '路线中' : '待排中'}
          </div>
          {indexLabel ? (
            <div className="absolute right-2 top-2 inline-flex rounded-full border border-white/50 bg-black/35 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              {indexLabel}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="line-clamp-1 text-sm font-semibold text-slate-900 sm:text-base">{preview.title}</h3>
              <p className="line-clamp-1 text-xs text-slate-500">{preview.subtitle}</p>
            </div>
            {sortable ? (
              <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                按住拖动
              </span>
            ) : null}
          </div>

          <p className="truncate rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-500">{point.pointId}</p>

          <div className="flex flex-wrap items-center gap-2">
            {onMoveToSorted ? (
              <button
                type="button"
                disabled={!canMoveToSorted}
                className="inline-flex min-h-8 flex-1 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-45"
                onClick={onMoveToSorted}
                title={canMoveToSorted ? '移入路线' : `已排序区最多 ${SORTED_LIMIT} 个`}
                {...DRAG_SAFE_CONTROL_PROPS}
              >
                加入路线
              </button>
            ) : null}
            <button
              onClick={() => onRemove(point.pointId)}
              {...DRAG_SAFE_CONTROL_PROPS}
            >
              移除
            </button>
          </div>
        </div>
      </div>
    </article>
  )
})

export const SortablePointCard = React.memo(function SortablePointCard({
  point,
  preview,
  onRemove,
  canMoveToSorted,
}: {
  point: PointRecord
  preview: PointPreview
  onRemove: (pointId: string) => void
  canMoveToSorted: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortedDragId(point.id) })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none">
      <PointCard
        point={point}
        preview={preview}
        indexLabel={`#${point.sortOrder + 1}`}
        onRemove={onRemove}
        canMoveToSorted={canMoveToSorted}
        sortable
        isDragging={isDragging}
      />
    </div>
  )
})

export function PointPoolCard({
  item,
  preview,
  onAdd,
  sortable,
  isDragging,
}: {
  item: PointPoolItem
  preview: PointPreview
  onAdd: () => void
  sortable?: boolean
  isDragging?: boolean
}) {
  return (
    <article
      className={`group overflow-hidden rounded-2xl border bg-white shadow-[0_14px_30px_-25px_rgba(15,23,42,0.45)] transition ${
        isDragging ? 'border-brand-300 ring-2 ring-brand-200/70' : 'border-slate-200'
      } ${sortable ? 'cursor-grab select-none active:cursor-grabbing' : ''}`}
    >
      <div className="flex min-w-0 items-stretch">
        <div className="relative h-28 w-36 shrink-0 overflow-hidden border-r border-slate-100 sm:h-32 sm:w-44">
          <PointThumb preview={preview} seed={item.pointId} />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,6,23,0.68)_10%,rgba(2,6,23,0.08)_58%,rgba(255,255,255,0)_100%)]" />
          <div className="absolute left-2 top-2 inline-flex rounded-full border border-white/55 bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-slate-700 backdrop-blur-sm">
            全局想去
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-1 text-sm font-semibold text-slate-900 sm:text-base">{preview.title}</h3>
            {sortable ? (
              <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                拖入路线
              </span>
            ) : null}
          </div>
          <p className="line-clamp-1 text-xs text-slate-500">{preview.subtitle}</p>
          <p className="truncate rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-500">{item.pointId}</p>
          <button
            type="button"
            className="inline-flex min-h-8 w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
            onClick={onAdd}
            {...DRAG_SAFE_CONTROL_PROPS}
          >
            加入当前地图
          </button>
        </div>
      </div>
    </article>
  )
}


export function DraggablePointPoolCard({
  item,
  preview,
  onAdd,
}: {
  item: PointPoolItem
  preview: PointPreview
  onAdd: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: poolDragId(item.id),
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none">
      <PointPoolCard
        item={item}
        preview={preview}
        onAdd={onAdd}
        sortable
        isDragging={isDragging}
      />
    </div>
  )
}
