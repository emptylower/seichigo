'use client'

import { useMemo, useState } from 'react'
import { Check, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import AttributionLink, { resolveAnitabiAttributionHref } from '@/components/anitabi/AttributionLink'
import type { PointPoolItem, PointPreview, RouteBookDetail } from '../types'
import { poolDragId } from '../utils'
import type { CreateItemInput } from '../hooks/useTripData'

type PoolEntry = {
  key: string
  pointId: string
  /** 池内点位（可 drag id=pool:<poolItemId>）；已在行程本的条目不可从右栏拖（在左栏拖） */
  poolItemId: string | null
  /** 未安排条目 id（「+」= reorder 到选中天）；scheduled 为 null */
  unassignedItemId: string | null
  /** 已安排的天序号（同一 pointId 多天合并一行，显示 Day 1·3）；未安排/池内为 [] */
  scheduledDayIndexes: number[]
}

type Chip = 'all' | 'unassigned' | 'scheduled'

const CHIP_LABEL: Record<Chip, string> = {
  all: '全部',
  unassigned: '未安排',
  scheduled: '已安排',
}

function buildEntries(detail: RouteBookDetail, pointPoolItems: PointPoolItem[]): PoolEntry[] {
  const dayIndexById = new Map(detail.days.map((day) => [day.id, day.dayIndex]))
  const entries: PoolEntry[] = []
  const poolPointIds = new Set<string>()

  for (const item of pointPoolItems) {
    poolPointIds.add(item.pointId)
    entries.push({
      key: `pool:${item.id}`,
      pointId: item.pointId,
      poolItemId: item.id,
      unassignedItemId: null,
      scheduledDayIndexes: [],
    })
  }

  const scheduledByPointId = new Map<string, number[]>()
  for (const item of detail.items) {
    if (item.kind !== 'point' || !item.pointId) continue
    if (item.dayId === null) {
      entries.push({
        key: `item:${item.id}`,
        pointId: item.pointId,
        poolItemId: null,
        unassignedItemId: item.id,
        scheduledDayIndexes: [],
      })
    } else {
      const dayIndex = dayIndexById.get(item.dayId)
      if (dayIndex === undefined) continue
      const list = scheduledByPointId.get(item.pointId) ?? []
      list.push(dayIndex)
      scheduledByPointId.set(item.pointId, list)
    }
  }

  for (const [pointId, indexes] of scheduledByPointId) {
    const unique = [...new Set(indexes)].sort((a, b) => a - b)
    entries.push({
      key: `scheduled:${pointId}`,
      pointId,
      poolItemId: null,
      unassignedItemId: null,
      scheduledDayIndexes: unique,
    })
  }

  return entries
}

function EntryCard({
  entry,
  preview,
  selectedDayIndex,
  onAdd,
  onMoveToSelectedDay,
  onAddAnotherDay,
  onFocus,
  onRemoveFromPool,
  manageMode,
}: {
  entry: PoolEntry
  preview: PointPreview
  selectedDayIndex: number | null
  onAdd: () => void
  onMoveToSelectedDay: () => void
  onAddAnotherDay: () => void
  onFocus: () => void
  onRemoveFromPool: () => void
  manageMode: boolean
}) {
  const scheduled = entry.scheduledDayIndexes.length > 0
  const alreadyOnSelectedDay = selectedDayIndex !== null && entry.scheduledDayIndexes.includes(selectedDayIndex)

  const action = (() => {
    if (manageMode && entry.poolItemId) {
      return (
        <button
          type="button"
          aria-label="从点位池删除"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
          onClick={onRemoveFromPool}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )
    }
    if (entry.poolItemId) {
      return (
        <button
          type="button"
          aria-label="加入行程"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/85 text-slate-700 transition hover:bg-brand-500 hover:text-white"
          onClick={onAdd}
        >
          <Plus className="h-4 w-4" />
        </button>
      )
    }
    if (entry.unassignedItemId) {
      return (
        <button
          type="button"
          aria-label="移到选中天"
          disabled={selectedDayIndex === null}
          title={selectedDayIndex === null ? '先在左侧选中一天' : '移到选中天末尾'}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/85 text-slate-700 transition hover:bg-brand-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onMoveToSelectedDay}
        >
          <Plus className="h-4 w-4" />
        </button>
      )
    }
    return (
      <button
        type="button"
        aria-label="再加一天"
        disabled={selectedDayIndex === null || alreadyOnSelectedDay}
        title={alreadyOnSelectedDay ? '已在选中天' : '再安排到选中天'}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/85 text-slate-700 transition hover:bg-brand-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onAddAnotherDay}
      >
        {alreadyOnSelectedDay ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </button>
    )
  })()

  return (
    <article className="group flex items-center gap-3 rounded-[24px] border border-slate-200 bg-white p-3 transition hover:border-pink-200">
      <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-[18px] bg-slate-100">
        {preview.image ? (
          <img src={preview.image} alt={preview.title} loading="lazy" decoding="async" className="h-full w-full object-cover object-center" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-100 via-white to-cyan-100 text-[11px] font-medium text-slate-500">
            暂无图
          </div>
        )}
      </div>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={scheduled ? onFocus : undefined}
        disabled={!scheduled}
      >
        <h3 className="truncate text-sm font-semibold text-slate-900">{preview.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            {preview.subtitle}
          </span>
          {scheduled ? (
            <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-600">
              Day {entry.scheduledDayIndexes.join('·')}
            </span>
          ) : entry.unassignedItemId ? (
            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">
              未安排
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-600">
              池内
            </span>
          )}
        </div>
        {preview.image ? (
          <div className="mt-2">
            <AttributionLink href={resolveAnitabiAttributionHref(preview.image)} className="text-[11px] text-slate-500" />
          </div>
        ) : null}
      </button>
      {action}
    </article>
  )
}

function DraggablePoolEntry(props: Parameters<typeof EntryCard>[0] & { dragId: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.dragId,
    disabled: props.manageMode,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.72 : 1 }}
      {...attributes}
      {...listeners}
      className={props.manageMode ? '' : 'touch-none'}
    >
      <EntryCard {...props} />
    </div>
  )
}

export function PlannerPointPoolDragOverlay({ preview }: { preview: PointPreview }) {
  return (
    <article className="flex w-64 items-center gap-3 rounded-[24px] border border-brand-200 bg-white p-3 shadow-lg">
      <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-[18px] bg-slate-100">
        {preview.image ? (
          <img src={preview.image} alt={preview.title} className="h-full w-full object-cover object-center" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-pink-100 via-white to-cyan-100 text-[11px] font-medium text-slate-500">
            暂无图
          </div>
        )}
      </div>
      <h3 className="truncate text-sm font-semibold text-slate-900">{preview.title}</h3>
    </article>
  )
}

type PlannerPointPoolPanelProps = {
  detail: RouteBookDetail
  pointPoolItems: PointPoolItem[]
  selectedDayId: string | null
  getPointPreview: (pointId: string) => PointPreview
  onAddItem: (dayId: string | null, input: CreateItemInput) => void
  onReorder: (targetDayId: string | null, orderedIds: string[]) => void
  onFocusPoint: (pointId: string) => void
  onRemoveFromPool: (pointId: string) => void
  compact?: boolean
  enableDrag?: boolean
}

export function PlannerPointPoolPanel({
  detail,
  pointPoolItems,
  selectedDayId,
  getPointPreview,
  onAddItem,
  onReorder,
  onFocusPoint,
  onRemoveFromPool,
  compact = false,
  enableDrag = false,
}: PlannerPointPoolPanelProps) {
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<Chip>('all')
  const [workFilter, setWorkFilter] = useState('全部')
  const [manageMode, setManageMode] = useState(false)

  const entries = useMemo(() => buildEntries(detail, pointPoolItems), [detail, pointPoolItems])
  const selectedDayIndex = useMemo(
    () => detail.days.find((day) => day.id === selectedDayId)?.dayIndex ?? null,
    [detail.days, selectedDayId]
  )

  const workOptions = useMemo(() => {
    const values = Array.from(new Set(entries.map((entry) => getPointPreview(entry.pointId).subtitle).filter(Boolean)))
    return ['全部', ...values]
  }, [entries, getPointPreview])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (chip === 'unassigned' && !(entry.poolItemId || entry.unassignedItemId)) return false
      if (chip === 'scheduled' && entry.scheduledDayIndexes.length === 0) return false
      const preview = getPointPreview(entry.pointId)
      if (workFilter !== '全部' && preview.subtitle !== workFilter) return false
      if (!normalized) return true
      return (
        preview.title.toLowerCase().includes(normalized) ||
        preview.subtitle.toLowerCase().includes(normalized) ||
        entry.pointId.toLowerCase().includes(normalized)
      )
    })
  }, [chip, entries, getPointPreview, query, workFilter])

  const moveUnassignedToSelectedDay = (itemId: string) => {
    if (!selectedDayId) return
    const dayIds = detail.items
      .filter((row) => row.dayId === selectedDayId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => row.id)
    onReorder(selectedDayId, [...dayIds, itemId])
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[32px] border border-pink-100/90 bg-white p-4 shadow-[0_24px_44px_-34px_rgba(15,23,42,0.42)]">
      <div className="space-y-3 rounded-[28px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(252,244,247,0.92))] p-4 shadow-[0_18px_36px_-30px_rgba(225,29,72,0.3)] ring-1 ring-pink-100/60">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-50 text-brand-600">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">点位池</h2>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              {entries.length} 个候选点位{selectedDayIndex !== null ? `，「+」加入 Day ${selectedDayIndex}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setManageMode((prev) => !prev)}
            className={`inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-xs font-semibold transition ${
              manageMode ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-200/80' : 'bg-white text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-50'
            }`}
          >
            {manageMode ? '完成管理' : '管理'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {(['all', 'unassigned', 'scheduled'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`inline-flex min-h-9 flex-1 items-center justify-center rounded-full border px-3 text-xs font-medium transition ${
                chip === key ? 'border-brand-500 bg-brand-500 text-white' : 'border-pink-100 bg-white text-slate-700 hover:border-pink-200 hover:bg-pink-50/60'
              }`}
              onClick={() => setChip(key)}
            >
              {CHIP_LABEL[key]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="relative block flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索点位、作品或 pointId"
              className="w-full rounded-[20px] border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
            />
          </label>
          <select
            aria-label="按作品筛选"
            value={workFilter}
            className="h-10 max-w-[9rem] rounded-[20px] border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-700 outline-none transition focus:border-brand-300 focus:bg-white"
            onChange={(event) => setWorkFilter(event.target.value)}
          >
            {workOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1">
        {filtered.length > 0 ? (
          <div className={`space-y-3 ${compact ? 'pb-24' : 'seichi-soft-scrollbar h-full overflow-y-auto pr-2'}`}>
            {filtered.map((entry) => {
              const preview = getPointPreview(entry.pointId)
              const card = (
                <EntryCard
                  key={entry.key}
                  entry={entry}
                  preview={preview}
                  selectedDayIndex={selectedDayIndex}
                  manageMode={manageMode}
                  onAdd={() => onAddItem(selectedDayId ?? null, { kind: 'point', pointId: entry.pointId })}
                  onMoveToSelectedDay={() => entry.unassignedItemId && moveUnassignedToSelectedDay(entry.unassignedItemId)}
                  onAddAnotherDay={() => selectedDayId && onAddItem(selectedDayId, { kind: 'point', pointId: entry.pointId })}
                  onFocus={() => onFocusPoint(entry.pointId)}
                  onRemoveFromPool={() => onRemoveFromPool(entry.pointId)}
                />
              )
              if (enableDrag && entry.poolItemId && !manageMode) {
                return <DraggablePoolEntry key={entry.key} {...card.props} dragId={poolDragId(entry.poolItemId)} />
              }
              return card
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-[16rem] flex-col items-center justify-center rounded-[28px] border border-dashed border-pink-200 bg-pink-50/30 px-6 text-center">
            <Search className="h-6 w-6 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              {entries.length === 0 ? '点位池还是空的' : '没有找到匹配的点位'}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {entries.length === 0 ? (
                <>
                  去
                  <a href="/anitabi" className="mx-1 font-semibold text-brand-600 hover:underline">
                    圣地地图
                  </a>
                  收藏想去的圣地，再回来整理行程。
                </>
              ) : (
                '换个作品或搜索关键词试试。'
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
