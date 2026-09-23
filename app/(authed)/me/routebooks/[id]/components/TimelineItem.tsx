'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlertTriangle,
  Bookmark,
  Camera,
  Clock,
  GripVertical,
  Info,
  Lock,
  LockOpen,
  MapPin,
  ShoppingBag,
  Star,
  Ticket,
  TrainFront,
  Trash2,
  Utensils,
} from 'lucide-react'
import type { DayRecord, ItemRecord, PlaceRecord, PointPreview } from '../types'
import { DRAG_SAFE_CONTROL_PROPS } from '../types'
import { dayLabel, itemDisplayTitle, itemDragId, pickPointGradient } from '../utils'
import type { UpdateItemInput } from '../hooks/useTripData'

const NOTE_ICON = {
  info: Info,
  clock: Clock,
  train: TrainFront,
  utensils: Utensils,
  ticket: Ticket,
  camera: Camera,
  'shopping-bag': ShoppingBag,
  alert: AlertTriangle,
  star: Star,
  bookmark: Bookmark,
} as const

const NOTE_COLOR_STYLE: Record<string, string> = {
  gray: 'border-slate-200 bg-slate-50/80 text-slate-600',
  pink: 'border-pink-200 bg-pink-50/80 text-pink-700',
  amber: 'border-amber-200 bg-amber-50/80 text-amber-700',
  green: 'border-emerald-200 bg-emerald-50/80 text-emerald-700',
  sky: 'border-sky-200 bg-sky-50/80 text-sky-700',
  violet: 'border-violet-200 bg-violet-50/80 text-violet-700',
}

const PLACE_KIND_LABEL: Record<string, string> = {
  lodging: '住宿',
  station: '车站',
  restaurant: '餐厅',
  other: '地点',
}

function readTransportDurationMin(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const transport = (payload as Record<string, unknown>).transport
  if (!transport || typeof transport !== 'object' || Array.isArray(transport)) return null
  const durationMin = (transport as Record<string, unknown>).durationMin
  return typeof durationMin === 'number' ? durationMin : null
}

function TimeBadge({ item }: { item: ItemRecord }) {
  if (!item.timeStart) return null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        item.locked ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {item.locked ? <Lock className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {item.timeStart}
      {item.timeEnd ? `–${item.timeEnd}` : ''}
    </span>
  )
}

type TimelineItemProps = {
  item: ItemRecord
  preview: PointPreview | null
  places: PlaceRecord[]
  days: DayRecord[]
  staleTransit: boolean
  onUpdate: (data: UpdateItemInput) => void
  onDelete: () => void
  onMoveItem: (targetDayId: string | null) => void
  /** B4：point/place 条目点击正文打开详情卡（不影响拖拽与右侧操作按钮） */
  onOpenDetail?: () => void
}

export function TimelineItem({
  item,
  preview,
  places,
  days,
  staleTransit,
  onUpdate,
  onDelete,
  onMoveItem,
  onOpenDetail,
}: TimelineItemProps) {
  const [editingTime, setEditingTime] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemDragId(item.id),
    disabled: item.kind === 'transit',
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  const title = itemDisplayTitle(item, preview, places)
  const place = item.kind === 'place' ? places.find((row) => row.id === item.placeId) : undefined

  const body = (() => {
    if (item.kind === 'transit') {
      const durationMin = readTransportDurationMin(item.payload)
      return (
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-500">
          <TrainFront className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">{title}</span>
          {durationMin !== null ? <span className="shrink-0">约 {Math.round(durationMin)} 分钟</span> : null}
          {staleTransit ? <span className="shrink-0 rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-400">已失效</span> : null}
        </div>
      )
    }

    if (item.kind === 'note') {
      const Icon = NOTE_ICON[(item.icon ?? 'info') as keyof typeof NOTE_ICON] ?? Info
      const colorStyle = NOTE_COLOR_STYLE[item.color ?? 'gray'] ?? NOTE_COLOR_STYLE.gray!
      return (
        <div className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs ${colorStyle}`}>
          <Icon className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-medium">{title}</div>
            {item.note ? <div className="mt-0.5 line-clamp-2 text-[11px] opacity-80">{item.note}</div> : null}
          </div>
        </div>
      )
    }

    if (item.kind === 'place') {
      return (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <MapPin className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-slate-900">{title}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {PLACE_KIND_LABEL[place?.kind ?? 'other'] ?? '地点'}
              </span>
            </div>
            {place?.address ? <div className="mt-0.5 truncate text-[11px] text-slate-400">{place.address}</div> : null}
          </div>
        </div>
      )
    }

    // point：缩略图 + 名 + 作品名
    const gradient = pickPointGradient(item.pointId ?? item.id)
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">
          {preview?.image ? (
            <img src={preview.image} alt={preview.title} loading="lazy" decoding="async" className="h-full w-full object-cover object-center" />
          ) : (
            <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient} text-[9px] font-semibold text-white`}>
              暂无图
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
          {preview?.subtitle ? <div className="mt-0.5 truncate text-[11px] text-slate-400">{preview.subtitle}</div> : null}
        </div>
      </div>
    )
  })()

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-start gap-1.5 rounded-2xl border px-2 py-2 transition ${
        item.kind === 'transit'
          ? 'border-transparent bg-slate-50/60'
          : 'border-pink-100/80 bg-white shadow-[0_10px_22px_-20px_rgba(15,23,42,0.4)]'
      } ${isDragging ? 'z-10 border-brand-300 ring-2 ring-brand-200/70' : ''}`}
    >
      {item.kind !== 'transit' ? (
        <button
          type="button"
          aria-label="拖动排序"
          className="mt-1.5 inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        {onOpenDetail && (item.kind === 'point' || item.kind === 'place') ? (
          <button
            type="button"
            aria-label={`查看 ${title}`}
            className="block w-full cursor-pointer rounded-lg text-left transition hover:bg-pink-50/60"
            onClick={onOpenDetail}
          >
            {body}
          </button>
        ) : (
          body
        )}
        {item.kind !== 'transit' ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <TimeBadge item={item} />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
        {editingTime ? (
          <input
            type="time"
            defaultValue={item.timeStart ?? ''}
            autoFocus
            className="h-8 rounded-lg border border-pink-200 bg-white px-1.5 text-xs text-slate-700 outline-none focus:border-brand-400"
            onBlur={(event) => {
              const value = event.target.value
              setEditingTime(false)
              if (value) onUpdate({ timeStart: value, locked: true })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              if (event.key === 'Escape') setEditingTime(false)
            }}
            {...DRAG_SAFE_CONTROL_PROPS}
          />
        ) : (
          <button
            type="button"
            aria-label="设时间"
            title="设时间（手动时间会成为锚点）"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={() => setEditingTime(true)}
            {...DRAG_SAFE_CONTROL_PROPS}
          >
            <Clock className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label={item.locked ? '解锁' : '锁定'}
          title={item.locked ? '解锁时间锚' : '锁定为时间锚'}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-slate-100 ${
            item.locked ? 'text-brand-500' : 'text-slate-400 hover:text-slate-600'
          }`}
          onClick={() => onUpdate({ locked: !item.locked })}
          {...DRAG_SAFE_CONTROL_PROPS}
        >
          {item.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
        </button>
        <select
          aria-label="移到…"
          title="移到…"
          value=""
          className="h-8 w-8 cursor-pointer rounded-lg border-none bg-transparent text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-600"
          onChange={(event) => {
            const value = event.target.value
            if (!value) return
            onMoveItem(value === 'unassigned' ? null : value)
          }}
          {...DRAG_SAFE_CONTROL_PROPS}
        >
          <option value="" disabled>
            ⇄
          </option>
          {days.map((day) => (
            <option key={day.id} value={day.id} disabled={day.id === item.dayId}>
              {dayLabel(day, day.dayIndex)}
            </option>
          ))}
          <option value="unassigned" disabled={item.dayId === null}>
            未安排
          </option>
        </select>
        <button
          type="button"
          aria-label="删除"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          onClick={onDelete}
          {...DRAG_SAFE_CONTROL_PROPS}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
