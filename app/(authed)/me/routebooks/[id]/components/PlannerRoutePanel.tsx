'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, GripVertical, MapPin, RotateCcw, Route, Settings2, Trash2 } from 'lucide-react'
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
  showRemoveAction = false,
  compact = false,
}: {
  point: PointRecord
  preview: PointPreview
  onRemove: (pointId: string) => void
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
  dragging?: boolean
  showRemoveAction?: boolean
  compact?: boolean
}) {
  const mobileManageAction = compact && showRemoveAction

  return (
    <article
      className={`group relative overflow-hidden rounded-[28px] border bg-white transition ${
        dragging
          ? 'border-brand-300 shadow-[0_26px_40px_-30px_rgba(219,39,119,0.42)]'
          : 'border-pink-100/90 shadow-[0_18px_32px_-28px_rgba(15,23,42,0.34)]'
      }`}
    >
      <div className={`px-3 py-3 ${compact ? 'sm:px-4' : 'sm:px-4 sm:py-4'}`}>
        <div className={`flex gap-3 ${compact ? 'flex-col sm:flex-row sm:items-center' : 'items-center'}`}>
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

        <div className={`relative overflow-hidden rounded-[24px] bg-slate-100 ${compact ? 'h-40 w-full sm:h-28 sm:w-28 sm:shrink-0' : 'h-24 w-24 shrink-0 sm:h-28 sm:w-28'}`}>
          {preview.image ? (
            <img
              src={preview.image}
              alt={preview.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-center"
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
            {showRemoveAction && !mobileManageAction ? (
              <button
                type="button"
                aria-label="移出路线"
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                onClick={() => onRemove(point.pointId)}
              >
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin className="h-3 w-3 text-brand-400" />
            <span className="truncate">点位 ID: {point.pointId}</span>
          </div>
        </div>
        </div>

        {mobileManageAction ? (
          <div className="mt-3 flex">
            <button
              type="button"
              aria-label="移出路线"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
              onClick={() => onRemove(point.pointId)}
            >
              <Trash2 className="h-4 w-4" />
              从路线中删除
            </button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function SortableRouteStop({
  point,
  preview,
  onRemove,
  showRemoveAction,
}: {
  point: PointRecord
  preview: PointPreview
  onRemove: (pointId: string) => void
  showRemoveAction: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortedDragId(point.id),
  })

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.72 : 1 }}>
      <RouteStopCard
        point={point}
        preview={preview}
        onRemove={onRemove}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragging={isDragging}
        showRemoveAction={showRemoveAction}
      />
    </div>
  )
}

function CheckedInCard({
  point,
  preview,
  onRestore,
}: {
  point: PointRecord
  preview: PointPreview
  onRestore: (pointId: string) => void
}) {
  return (
    <article className="overflow-hidden rounded-[26px] border border-emerald-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,253,244,0.92))] shadow-[0_18px_32px_-28px_rgba(21,128,61,0.28)]">
      <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[20px] bg-slate-100">
          {preview.image ? (
            <img src={preview.image} alt={preview.title} loading="lazy" decoding="async" className="h-full w-full object-cover object-center" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-100 via-white to-cyan-100 px-2 text-center text-[11px] font-medium text-slate-500">
              暂无图片
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已打卡
            </span>
            <span className="inline-flex rounded-full bg-white px-2 py-1 text-[10px] font-medium text-slate-500 shadow-sm">
              #{point.sortOrder + 1}
            </span>
          </div>
          <h3 className="mt-2 line-clamp-1 text-sm font-semibold text-slate-900 sm:text-base">{preview.title}</h3>
          <p className="mt-1 line-clamp-1 text-xs text-slate-500">{preview.subtitle}</p>
        </div>

        <button
          type="button"
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-4 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 sm:h-11 sm:w-auto sm:rounded-full"
          onClick={() => onRestore(point.pointId)}
        >
          <RotateCcw className="h-4 w-4" />
          恢复到路线
        </button>
      </div>
    </article>
  )
}

interface PlannerRoutePanelProps {
  sorted: PointRecord[]
  checkedIn: PointRecord[]
  getPointPreview: (pointId: string) => PointPreview
  onRemove: (pointId: string) => void
  onRestoreCheckedIn: (pointId: string) => void
  enableDrag?: boolean
}

export function PlannerRoutePanel({
  sorted,
  checkedIn,
  getPointPreview,
  onRemove,
  onRestoreCheckedIn,
  enableDrag = false,
}: PlannerRoutePanelProps) {
  const [activeTab, setActiveTab] = useState<'route' | 'checked'>('route')
  const [routeManageMode, setRouteManageMode] = useState(false)

  const routeContent = sorted.length > 0 ? (
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
                showRemoveAction={routeManageMode}
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
            showRemoveAction={routeManageMode}
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
      <h3 className="mt-4 text-base font-semibold text-slate-900">先从点位池挑选想去的圣地</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{enableDrag ? '桌面端支持直接拖进路线区并调整顺序。' : '添加点位后会自动出现在这里。'}</p>
    </div>
  )

  const checkedContent = useMemo(() => {
    if (!checkedIn.length) {
      return (
        <div className="rounded-[28px] border border-dashed border-emerald-200 bg-emerald-50/40 px-6 py-10 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-900">还没有已打卡点位</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">打卡后的点位会出现在这里，误操作时也可以从这里恢复。</p>
        </div>
      )
    }

    return (
      <div className="space-y-3">
        {checkedIn.map((point) => (
          <CheckedInCard key={point.id} point={point} preview={getPointPreview(point.pointId)} onRestore={onRestoreCheckedIn} />
        ))}
      </div>
    )
  }, [checkedIn, getPointPreview, onRestoreCheckedIn])

  const header = (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">路线管理</h2>
          <p className="text-xs text-slate-500">切换查看路线中或已打卡点位，管理动作只在对应模式下显示。</p>
        </div>
        {activeTab === 'route' ? (
          <button
            type="button"
            onClick={() => setRouteManageMode((prev) => !prev)}
            className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition sm:min-h-0 sm:w-auto sm:rounded-full sm:text-xs ${routeManageMode ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {routeManageMode ? '完成管理' : '管理路线'}
          </button>
        ) : (
          <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">恢复已打卡</span>
        )}
      </div>

      <div className="grid grid-cols-2 rounded-2xl bg-white/80 p-1 shadow-sm ring-1 ring-pink-100/80 sm:inline-flex">
        {([
          ['route', `路线中 ${sorted.length}`],
          ['checked', `已打卡 ${checkedIn.length}`],
        ] as const).map(([key, label]) => {
          const active = activeTab === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition ${active ? 'bg-brand-500 text-white shadow-[0_12px_24px_-18px_rgba(225,29,72,0.7)]' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </>
  )

  if (!enableDrag) {
    return (
      <section className="space-y-3">
        {header}
        {activeTab === 'route' ? routeContent : checkedContent}
      </section>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[32px] border border-pink-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,247,250,0.9))] p-4 shadow-[0_24px_44px_-34px_rgba(15,23,42,0.42)]">
      <div className="mb-4 space-y-4">{header}</div>

      {activeTab === 'route' ? (
        <DroppablePanel
          id={SORTED_ZONE_ID}
          className="min-h-0 flex-1 rounded-[28px] border border-transparent bg-white/75 p-1 transition"
          activeClassName="border-brand-200 bg-brand-50/40"
        >
          <div className="seichi-soft-scrollbar h-full min-h-0 space-y-3 overflow-y-auto p-2 pr-3">{routeContent}</div>
        </DroppablePanel>
      ) : (
        <div className="seichi-soft-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">{checkedContent}</div>
      )}
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
