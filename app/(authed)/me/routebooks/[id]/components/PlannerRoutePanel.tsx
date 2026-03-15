'use client'

import { GripVertical, MapPin, Route, X } from 'lucide-react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PointPreview, PointRecord } from '../types'
import { SORTED_ZONE_ID } from '../types'
import { sortedDragId } from '../utils'
import { DroppablePanel } from './DroppablePanel'

function RouteStopCard({
  point,
  preview,
  onRemove,
  dragHandleProps,
  dragging,
  compact = false,
}: {
  point: PointRecord
  preview: PointPreview
  onRemove: (pointId: string) => void
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
  dragging?: boolean
  compact?: boolean
}) {
  return (
    <article
      className={`group relative overflow-hidden rounded-[28px] border bg-white transition ${
        dragging
          ? 'border-brand-300 shadow-[0_26px_40px_-30px_rgba(219,39,119,0.42)]'
          : 'border-pink-100/90 shadow-[0_18px_32px_-28px_rgba(15,23,42,0.34)]'
      }`}
    >
      <div className={`flex items-center gap-3 px-3 py-3 ${compact ? 'sm:px-4' : 'sm:px-4 sm:py-4'}`}>
        <div className="flex items-center gap-2">
          {dragHandleProps ? (
            <button
              type="button"
              aria-label="拖动排序"
              className="inline-flex h-10 w-8 shrink-0 items-center justify-center rounded-2xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              {...dragHandleProps}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : null}
          <span className="inline-flex h-10 w-1.5 shrink-0 rounded-full bg-gradient-to-b from-brand-300 to-pink-100" />
        </div>

        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[24px] bg-slate-100 sm:h-28 sm:w-28">
          {preview.image ? (
            <img
              src={preview.image}
              alt={preview.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-100 via-white to-cyan-100 px-3 text-center text-xs font-semibold text-slate-500">
              暂无图片
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(15,23,42,0.38)_0%,rgba(15,23,42,0)_55%)]" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="line-clamp-2 text-base font-semibold leading-6 text-slate-900 sm:text-[17px]">{preview.title}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-pink-50 px-2.5 py-1 text-xs font-medium text-brand-600">
                  {preview.subtitle}
                </span>
              </div>
            </div>
            <button
              type="button"
              aria-label="移出路线"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              onClick={() => onRemove(point.pointId)}
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin className="h-3 w-3 text-brand-400" />
            <span className="truncate">点位 ID: {point.pointId}</span>
          </div>
        </div>
      </div>
    </article>
  )
}

function SortableRouteStop({
  point,
  preview,
  onRemove,
}: {
  point: PointRecord
  preview: PointPreview
  onRemove: (pointId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortedDragId(point.id),
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.72 : 1 }}
    >
      <RouteStopCard
        point={point}
        preview={preview}
        onRemove={onRemove}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragging={isDragging}
      />
    </div>
  )
}

interface PlannerRoutePanelProps {
  sorted: PointRecord[]
  getPointPreview: (pointId: string) => PointPreview
  onRemove: (pointId: string) => void
  enableDrag?: boolean
}

export function PlannerRoutePanel({
  sorted,
  getPointPreview,
  onRemove,
  enableDrag = false,
}: PlannerRoutePanelProps) {
  const content = sorted.length > 0 ? (
    <div className="space-y-3">
      {enableDrag ? (
        <SortableContext items={sorted.map((point) => sortedDragId(point.id))} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {sorted.map((point) => (
              <SortableRouteStop
                key={point.id}
                point={point}
                preview={getPointPreview(point.pointId)}
                onRemove={onRemove}
              />
            ))}
          </div>
        </SortableContext>
      ) : (
        sorted.map((point) => (
          <RouteStopCard
            key={point.id}
            point={point}
            preview={getPointPreview(point.pointId)}
            onRemove={onRemove}
            compact
          />
        ))
      )}
    </div>
  ) : (
    <div className="rounded-[28px] border border-dashed border-pink-200 bg-[linear-gradient(180deg,rgba(253,242,248,0.65),rgba(255,255,255,0.95))] px-6 py-10 text-center">
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-pink-100 text-brand-600">
        <Route className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">先从右侧点位池挑选想去的圣地</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {enableDrag ? '桌面端支持直接拖进路线区并调整顺序。' : '添加点位后会自动出现在这里。'}
      </p>
    </div>
  )

  if (!enableDrag) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">路线</h2>
            <p className="text-xs text-slate-500">按执行顺序整理今天的巡礼节奏</p>
          </div>
          <span className="inline-flex rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-brand-600">
            {sorted.length} 个点位
          </span>
        </div>
        {content}
      </section>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[32px] border border-pink-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,247,250,0.9))] p-4 shadow-[0_24px_44px_-34px_rgba(15,23,42,0.42)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">路线顺序</h2>
          <p className="text-xs text-slate-500">拖动卡片可调整巡礼顺序</p>
        </div>
        <span className="inline-flex rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-brand-600">
          {sorted.length} 个点位
        </span>
      </div>

      <DroppablePanel
        id={SORTED_ZONE_ID}
        className="min-h-0 flex-1 rounded-[28px] border border-transparent bg-white/75 p-1 transition"
        activeClassName="border-brand-200 bg-brand-50/40"
      >
        <div className="seichi-soft-scrollbar h-full min-h-0 space-y-3 overflow-y-auto p-2 pr-3">
          {content}
        </div>
      </DroppablePanel>
    </section>
  )
}

export function PlannerRouteDragOverlay({
  point,
  preview,
}: {
  point: PointRecord
  preview: PointPreview
}) {
  return <RouteStopCard point={point} preview={preview} onRemove={() => {}} dragging />
}
