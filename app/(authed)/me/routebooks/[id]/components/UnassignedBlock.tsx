'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Inbox } from 'lucide-react'
import type { DayRecord, ItemRecord, PlaceRecord, PointPreview } from '../types'
import { UNASSIGNED_DROP_ID } from '../types'
import { itemDragId } from '../utils'
import type { UpdateItemInput } from '../hooks/useTripData'
import { TimelineItem } from './TimelineItem'

type UnassignedBlockProps = {
  items: ItemRecord[]
  places: PlaceRecord[]
  days: DayRecord[]
  getPointPreview: (pointId: string) => PointPreview
  onUpdateItem: (itemId: string, data: UpdateItemInput) => void
  onDeleteItem: (itemId: string) => void
  onMoveItem: (itemId: string, targetDayId: string | null) => void
}

export function UnassignedBlock({
  items,
  places,
  days,
  getPointPreview,
  onUpdateItem,
  onDeleteItem,
  onMoveItem,
}: UnassignedBlockProps) {
  const { setNodeRef, isOver } = useDroppable({ id: UNASSIGNED_DROP_ID })

  return (
    <section
      ref={setNodeRef}
      aria-label="未安排"
      className={`rounded-[24px] border border-dashed border-slate-200 bg-white/60 px-2 py-2.5 transition ${
        isOver ? 'ring-2 ring-brand-300/70' : ''
      }`}
    >
      <div className="flex items-center gap-2 px-1.5 pb-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
          <Inbox className="h-4 w-4" />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-700">未安排</div>
          <div className="text-[11px] text-slate-400">{items.length} 条待分配</div>
        </div>
      </div>

      <SortableContext items={items.map((item) => itemDragId(item.id))} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {items.map((item) => (
            <TimelineItem
              key={item.id}
              item={item}
              preview={item.pointId ? getPointPreview(item.pointId) : null}
              places={places}
              days={days}
              staleTransit={false}
              onUpdate={(data) => onUpdateItem(item.id, data)}
              onDelete={() => onDeleteItem(item.id)}
              onMoveItem={(targetDayId) => onMoveItem(item.id, targetDayId)}
            />
          ))}
          {items.length === 0 ? (
            <div className="rounded-xl px-4 py-4 text-center text-xs text-slate-400">暂时没有待安排的条目</div>
          ) : null}
        </div>
      </SortableContext>
    </section>
  )
}
