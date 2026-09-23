'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Plus, Undo2 } from 'lucide-react'
import type {
  DayLegsResult,
  PointPreview,
  RouteBookDetail,
  TravelMode,
} from '../types'
import { groupItemsByDay } from '../utils'
import type { CreateItemInput, UpdateItemInput } from '../hooks/useTripData'
import { DayBlock } from './DayBlock'
import { UnassignedBlock } from './UnassignedBlock'

type DayPlanSidebarProps = {
  detail: RouteBookDetail
  selectedDayId: string | null
  onSelectDay: (dayId: string) => void
  getPointPreview: (pointId: string) => PointPreview
  legsByDay: Record<string, DayLegsResult>
  routeVisible: boolean
  onToggleRoute: () => void
  onOptimize: (dayId: string) => void
  onUndo: () => void
  undoLabel: string | null
  onAddItem: (dayId: string | null, input: CreateItemInput, index?: number) => void
  onUpdateItem: (itemId: string, data: UpdateItemInput) => void
  onDeleteItem: (itemId: string) => void
  onReorder: (targetDayId: string | null, orderedIds: string[]) => void
  onUpdateDay: (dayId: string, data: { defaultTravelMode?: TravelMode }) => void
  onInsertDay: (afterDayIndex: number) => void
  onDeleteDay: (dayId: string) => void
}

function readExpandedMap(routeBookId: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(`routebook-day-expanded-${routeBookId}`)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeExpandedMap(routeBookId: string, map: Record<string, boolean>) {
  try {
    window.localStorage.setItem(`routebook-day-expanded-${routeBookId}`, JSON.stringify(map))
  } catch {
    // 隐私模式等写入失败：折叠态只是偏好，静默即可
  }
}

export function DayPlanSidebar({
  detail,
  selectedDayId,
  onSelectDay,
  getPointPreview,
  legsByDay,
  routeVisible,
  onToggleRoute,
  onOptimize,
  onUndo,
  undoLabel,
  onUpdateItem,
  onDeleteItem,
  onReorder,
  onUpdateDay,
  onInsertDay,
  onDeleteDay,
}: DayPlanSidebarProps) {
  const days = useMemo(() => [...detail.days].sort((a, b) => a.dayIndex - b.dayIndex), [detail.days])
  const { byDay, unassigned } = useMemo(
    () => groupItemsByDay(detail.items, detail.days),
    [detail.days, detail.items]
  )

  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean>>({})
  const [allExpanded, setAllExpanded] = useState(true)

  useEffect(() => {
    setExpandedOverride(readExpandedMap(detail.id))
  }, [detail.id])

  const isExpanded = useCallback(
    (dayId: string) => expandedOverride[dayId] ?? true,
    [expandedOverride]
  )

  const persist = useCallback(
    (next: Record<string, boolean>) => {
      setExpandedOverride(next)
      writeExpandedMap(detail.id, next)
    },
    [detail.id]
  )

  const toggleDay = useCallback(
    (dayId: string) => {
      persist({ ...expandedOverride, [dayId]: !isExpanded(dayId) })
    },
    [expandedOverride, isExpanded, persist]
  )

  const setAll = useCallback(
    (expanded: boolean) => {
      const next: Record<string, boolean> = {}
      for (const day of days) next[day.id] = expanded
      persist(next)
      setAllExpanded(expanded)
    },
    [days, persist]
  )

  const handleMoveItem = useCallback(
    (itemId: string, targetDayId: string | null) => {
      const targetItems = targetDayId === null ? unassigned : byDay.get(targetDayId) ?? []
      const orderedIds = targetItems.map((row) => row.id).filter((rowId) => rowId !== itemId)
      onReorder(targetDayId, [...orderedIds, itemId])
    },
    [byDay, onReorder, unassigned]
  )

  const lastDayIndex = days.length ? days[days.length - 1]!.dayIndex : 0

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[32px] border border-pink-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,247,250,0.9))] p-3 shadow-[0_24px_44px_-34px_rgba(15,23,42,0.42)]">
      <div className="flex items-center gap-1.5 px-1 pb-2.5">
        <button
          type="button"
          disabled={!undoLabel}
          title={undoLabel ? `撤销：${undoLabel}` : '没有可撤销的操作'}
          className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-white px-2.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onUndo}
        >
          <Undo2 className="h-3.5 w-3.5" />
          撤销
        </button>
        <button
          type="button"
          title={allExpanded ? '全部折叠' : '全部展开'}
          className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-white px-2.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-pink-50"
          onClick={() => setAll(!allExpanded)}
        >
          {allExpanded ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
          {allExpanded ? '折叠' : '展开'}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-brand-500 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-600"
          onClick={() => onInsertDay(lastDayIndex)}
        >
          <Plus className="h-3.5 w-3.5" />
          添加一天
        </button>
      </div>

      <div className="seichi-soft-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {days.map((day) => (
          <DayBlock
            key={day.id}
            routeBookId={detail.id}
            day={day}
            items={byDay.get(day.id) ?? []}
            places={detail.places}
            days={days}
            selected={day.id === selectedDayId}
            onSelect={() => onSelectDay(day.id)}
            getPointPreview={getPointPreview}
            legs={legsByDay[day.id]}
            routeVisible={routeVisible}
            onToggleRoute={onToggleRoute}
            onOptimize={() => onOptimize(day.id)}
            onUpdateItem={onUpdateItem}
            onDeleteItem={onDeleteItem}
            onMoveItem={handleMoveItem}
            onUpdateDay={onUpdateDay}
            expanded={isExpanded(day.id)}
            onToggleExpanded={() => toggleDay(day.id)}
          />
        ))}

        <UnassignedBlock
          items={unassigned}
          places={detail.places}
          days={days}
          getPointPreview={getPointPreview}
          onUpdateItem={onUpdateItem}
          onDeleteItem={onDeleteItem}
          onMoveItem={handleMoveItem}
        />
      </div>
    </section>
  )
}
