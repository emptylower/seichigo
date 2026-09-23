import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { PointPoolItem, PointPreview } from '../types'
import { DRAG_SAFE_CONTROL_PROPS } from '../types'
import { pickPointGradient, poolDragId } from '../utils'

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
