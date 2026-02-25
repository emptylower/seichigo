import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { DroppablePanel } from './DroppablePanel'
import { SortablePointCard } from './PointCard'
import type { PointRecord, PointPreview } from '../types'
import { SORTED_ZONE_ID } from '../types'
import { sortedDragId } from '../utils'

interface RouteListPanelProps {
  sorted: PointRecord[]
  getPointPreview: (pointId: string) => PointPreview
  onRemove: (pointId: string) => void
  canAddToSorted: boolean
}

export function RouteListPanel({ sorted, getPointPreview, onRemove, canAddToSorted }: RouteListPanelProps) {
  const sortedIds = sorted.map((point) => sortedDragId(point.id))

  return (
    <DroppablePanel
      id={SORTED_ZONE_ID}
      className="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-sm transition"
      activeClassName="border-brand-300 bg-brand-50/35"
    >
      {sorted.length > 0 ? (
        <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
          <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
            {sorted.map((point) => (
              <SortablePointCard
                key={point.id}
                point={point}
                preview={getPointPreview(point.pointId)}
                onRemove={onRemove}
                canMoveToSorted={canAddToSorted}
              />
            ))}
          </div>
        </SortableContext>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          从下方全局想去池中，直接拖拽点位到此处即可加入路线。
        </div>
      )}
    </DroppablePanel>
  )
}
