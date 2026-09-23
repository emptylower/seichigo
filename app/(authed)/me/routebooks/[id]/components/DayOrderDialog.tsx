'use client'

import { useEffect, useState } from 'react'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ListOrdered, Loader2, Plus, Trash2, X } from 'lucide-react'
import type { DayRecord } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { dayLabel } from '../utils'
import { tr } from '../../i18n'

type Props = {
  open: boolean
  days: DayRecord[]
  /** 每天条目数（任何 kind 都算）：空天才可删 */
  itemCountByDay: Record<string, number>
  onSubmit: (orderedDayIds: string[]) => Promise<boolean | void> | boolean | void
  onInsertDay: (afterDayIndex: number) => void
  onDeleteDay: (dayId: string) => void
  onClose: () => void
  locale?: SupportedLocale
}

function SortableDayRow({
  day,
  count,
  deletable,
  onInsertBelow,
  onDelete,
  locale,
}: {
  day: DayRecord
  count: number
  deletable: boolean
  onInsertBelow: () => void
  onDelete: () => void
  locale: SupportedLocale
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: day.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className="flex items-center gap-2 rounded-2xl border border-pink-100/80 bg-white px-2.5 py-2"
    >
      <button
        type="button"
        aria-label={tr('routebook.timeline.dragSort', locale)}
        className="inline-flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900">{dayLabel(day, day.dayIndex, locale)}</div>
        <div className="text-[11px] text-slate-400">
          {day.title ? `${day.title} · ` : ''}
          {tr('routebook.common.stopCount', locale, { n: count })}
        </div>
      </div>
      <button
        type="button"
        aria-label={tr('routebook.dayOrder.insertBelow', locale)}
        title={tr('routebook.dayOrder.insertBelow', locale)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-pink-50 hover:text-brand-600"
        onClick={onInsertBelow}
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={tr('routebook.common.delete', locale)}
        title={deletable ? tr('routebook.dayOrder.deleteDay', locale) : tr('routebook.dayOrder.deleteBlocked', locale)}
        disabled={!deletable}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-35"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

/** 天顺序弹窗：dnd 排序（本地暂存，保存时提交）、任意位置插入、空天可删 */
export function DayOrderDialog({
  open,
  days,
  itemCountByDay,
  onSubmit,
  onInsertDay,
  onDeleteDay,
  onClose,
  locale = 'zh',
}: Props) {
  const [order, setOrder] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  // 打开时按当前顺序初始化；打开期间插入/删除天后合并进本地顺序
  useEffect(() => {
    if (!open) return
    const serverIds = [...days].sort((a, b) => a.dayIndex - b.dayIndex).map((day) => day.id)
    setOrder((prev) => {
      if (prev.length === 0) return serverIds
      const alive = prev.filter((id) => serverIds.includes(id))
      const added = serverIds.filter((id) => !alive.includes(id))
      return [...alive, ...added]
    })
  }, [open, days])

  if (!open) return null

  const dayById = new Map(days.map((day) => [day.id, day]))
  const orderedDays = order.map((id) => dayById.get(id)).filter((day): day is DayRecord => Boolean(day))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const from = prev.indexOf(String(active.id))
      const to = prev.indexOf(String(over.id))
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
  }

  const handleSubmit = async () => {
    if (submitting || orderedDays.length === 0) return
    setSubmitting(true)
    const outcome = await onSubmit(orderedDays.map((day) => day.id))
    setSubmitting(false)
    if (outcome !== false) onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label={tr('routebook.common.close', locale)}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-pink-100 bg-white p-5 shadow-2xl sm:rounded-[28px]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ListOrdered className="h-4 w-4 text-brand-500" />
            {tr('routebook.dayOrder.title', locale)}
          </h3>
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 px-1 text-xs text-slate-400">{tr('routebook.dayOrder.hint', locale)}</p>

        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedDays.map((day) => day.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {orderedDays.map((day) => (
                <SortableDayRow
                  key={day.id}
                  day={day}
                  count={itemCountByDay[day.id] ?? 0}
                  deletable={(itemCountByDay[day.id] ?? 0) === 0 && orderedDays.length > 1}
                  onInsertBelow={() => onInsertDay(day.dayIndex)}
                  onDelete={() => onDeleteDay(day.id)}
                  locale={locale}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <button
          type="button"
          disabled={submitting || orderedDays.length === 0}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[20px] bg-brand-500 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          onClick={() => void handleSubmit()}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {tr('routebook.dayOrder.submit', locale)}
        </button>
      </div>
    </div>
  )
}
